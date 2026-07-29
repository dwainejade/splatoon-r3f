import { useEffect, useMemo, useRef, useState } from 'react'
import { NETWORK } from '../settings.js'

// The multiplayer connection. A relay, not an authority: this hook only ever
// tells the server what the local player is doing and applies what other
// players are doing locally, so there is no server-side game state to keep in
// sync beyond "who is in the room and what colour are they."
//
// Remote player transforms live in a ref map rather than React state — they
// are read every frame by the renderer, and a room full of players updating
// state ten times a second would otherwise mean a re-render storm.
export default function useNetwork() {
  const [localId, setLocalId] = useState(null)
  const [localColor, setLocalColor] = useState(null)
  const remotePlayers = useRef(new Map()) // id -> { color, position, rotation }
  const socket = useRef(null)
  const splatHandlers = useRef(new Set())
  const fireHandlers = useRef(new Set())
  const joinHandlers = useRef(new Set())
  const leaveHandlers = useRef(new Set())

  useEffect(() => {
    let cancelled = false
    let ws

    const connect = () => {
      // StrictMode mounts, cleans up and mounts again in the same tick during
      // development; without this a slow-to-close previous socket can still
      // be joining the room's player list when the new one connects, which
      // is what a stray extra "player" in the room turns out to be.
      if (cancelled) return

      ws = new WebSocket(NETWORK.url)
      socket.current = ws

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)

        if (message.type === 'welcome') {
          setLocalId(message.id)
          setLocalColor(message.color)
          remotePlayers.current.clear()
          const now = performance.now()
          for (const player of message.players) {
            if (player.id === message.id) continue
            remotePlayers.current.set(player.id, {
              color: player.color,
              // previous/target bracket the interpolation window; with only
              // one sample so far both start there, so the avatar appears at
              // rest instead of easing in from the origin.
              previous: { position: player.position, rotation: player.rotation, time: now },
              target: { position: player.position, rotation: player.rotation, time: now },
            })
          }
          return
        }

        if (message.type === 'join') {
          const now = performance.now()
          remotePlayers.current.set(message.id, {
            color: message.color,
            previous: { position: message.position, rotation: message.rotation, time: now },
            target: { position: message.position, rotation: message.rotation, time: now },
          })
          for (const handler of joinHandlers.current) handler(message)
          return
        }

        if (message.type === 'leave') {
          remotePlayers.current.delete(message.id)
          for (const handler of leaveHandlers.current) handler(message)
          return
        }

        if (message.type === 'state') {
          const player = remotePlayers.current.get(message.id)
          if (player) {
            // The old target becomes the new previous, so the renderer always
            // has a real bracketing pair to interpolate between rather than
            // snapping to each new packet as it arrives.
            player.previous = player.target
            player.target = { position: message.position, rotation: message.rotation, time: performance.now() }
          }
          return
        }

        if (message.type === 'splat') {
          for (const handler of splatHandlers.current) handler(message)
          return
        }

        if (message.type === 'fire') {
          for (const handler of fireHandlers.current) handler(message)
          return
        }
      }

      ws.onclose = () => {
        socket.current = null
        if (!cancelled) setTimeout(connect, NETWORK.reconnectDelay)
      }
    }

    connect()
    return () => {
      cancelled = true
      // Drop the handlers before closing: a socket still mid-handshake fires
      // its close event asynchronously, and by then this effect may already
      // have been superseded by a fresh connect() from a remount (StrictMode
      // does this in the same tick). Without clearing onclose first, that
      // late event would schedule a reconnect for a connection this effect
      // no longer owns.
      if (ws) {
        ws.onmessage = null
        ws.onclose = null
        ws.close()
        if (socket.current === ws) socket.current = null
      }
    }
  }, [])

  return useMemo(
    () => ({
      localId,
      localColor,
      remotePlayers,

      sendState(position, rotation) {
        const ws = socket.current
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'state', position, rotation }))
      },

      sendSplat(splat) {
        const ws = socket.current
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'splat', ...splat }))
      },

      // Sent once per trigger pull, not per frame — every other client
      // simulates its own copy of the shot locally from these starting
      // conditions rather than having its position streamed.
      sendFire(fire) {
        const ws = socket.current
        if (ws?.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'fire', ...fire }))
      },

      // Called with every splat another player's client reports. Returns an
      // unsubscribe function, same shape as the DOM's own addEventListener.
      onRemoteSplat(handler) {
        splatHandlers.current.add(handler)
        return () => splatHandlers.current.delete(handler)
      },

      onRemoteFire(handler) {
        fireHandlers.current.add(handler)
        return () => fireHandlers.current.delete(handler)
      },

      onPlayerJoin(handler) {
        joinHandlers.current.add(handler)
        return () => joinHandlers.current.delete(handler)
      },

      onPlayerLeave(handler) {
        leaveHandlers.current.add(handler)
        return () => leaveHandlers.current.delete(handler)
      },
    }),
    [localId, localColor],
  )
}
