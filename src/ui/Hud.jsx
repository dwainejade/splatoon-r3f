import { INK, WEAPON_ORDER } from "../settings.js";

// Presentational only — every value it shows is passed in.
export default function Hud({ painted, ink, weapon, slot, playerCount }) {
  return (
    <>
      <div className="hud">
        <div className="brand">
          INK RUSH <span>prototype</span>
        </div>

        <div className="timer">{playerCount} online</div>

        {/* aria-live off: this updates several times a second and would flood
            a screen reader with no useful information. */}
        <div className="score" aria-live="off">
          <span>Painted</span>
          <strong>{painted.toFixed(1)}%</strong>
        </div>

        <div className="weapon">
          <span>
            Weapon {slot + 1}/{WEAPON_ORDER.length}
          </span>
          <strong>{weapon.name}</strong>
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
