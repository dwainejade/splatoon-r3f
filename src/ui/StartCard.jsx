// Shown once, before the player has joined the room. Its only real job is the
// click a browser requires before it will grant pointer lock.
export default function StartCard({ onStart }) {
  return (
    <section className="start-card">
      <p>A shared first-person paint sandbox.</p>

      <button onClick={onStart}>Join</button>

      <small>
        Click the arena to look around · WASD to move · Hold left click to spray
        · Hold right click for a burst · 1-3 to swap weapon
      </small>
    </section>
  );
}
