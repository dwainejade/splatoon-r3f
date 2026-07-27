import { INK } from "../settings.js";

function formatClock(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

// Presentational only — every value it shows is passed in.
export default function Hud({ remaining, painted, ink }) {
  return (
    <>
      <div className="hud">
        <div className="brand">
          INK RUSH <span>prototype</span>
        </div>

        <div className="timer">{formatClock(remaining)}</div>

        {/* aria-live off: this updates several times a second and would flood
            a screen reader with no useful information. */}
        <div className="score" aria-live="off">
          <span>Painted</span>
          <strong>{painted.toFixed(1)}%</strong>
        </div>

        <div className="ink">
          <span>INK</span>
          <div>
            <i style={{ width: `${(ink / INK.capacity) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="crosshair" aria-hidden="true">
        +
      </div>
    </>
  );
}
