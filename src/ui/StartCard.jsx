// Shown before the first run and again once the clock hits zero, where it
// doubles as the score screen.
export default function StartCard({ finished, painted, onStart }) {
  return (
    <section className="start-card">
      {finished ? (
        <p>
          Run complete — you covered <strong>{painted.toFixed(1)}%</strong>.
        </p>
      ) : (
        <p>A first-person paint time attack.</p>
      )}

      <button onClick={onStart}>
        {finished ? "Run it again" : "Start 3-minute run"}
      </button>

      <small>
        Click the arena to look around · WASD to move · Hold left click to spray
        · Hold right click for a burst
      </small>
    </section>
  );
}
