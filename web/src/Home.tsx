// Copyright (c) 2026 Vassel Goleyu. SPDX-License-Identifier: MIT
import { T } from "./copy";
import { fmt1, fmt2, parseMeters, rt60Target, roomVolume, type Room } from "./measure";

interface Props {
  room: Room;
  onRoom(r: Room): void;
  onStart(): void;
}

const FIELDS = ["length", "width", "height"] as const;

export function Home({ room, onRoom, onStart }: Props) {
  const volume = roomVolume(room);
  const target = volume === null ? null : rt60Target(volume);
  const set = (k: keyof Room, v: string) => onRoom({ ...room, [k]: v });
  return (
    <>
      <section className="hero">
        <h1 tabIndex={-1}>{T.home.title}</h1>
        <p className="lead">{T.home.lead}</p>
      </section>

      <section aria-labelledby="steps-h" className="card">
        <h2 id="steps-h">{T.home.stepsTitle}</h2>
        <ol className="how">
          {T.home.steps.map((s, i) => (
            <li key={s.t}>
              <span className="how-n" aria-hidden="true">{i + 1}</span>
              <div>
                <strong>{s.t}</strong>
                <p>{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="room-h" className="card">
        <h2 id="room-h">{T.home.roomTitle}</h2>
        <p className="muted">{T.home.roomLead}</p>
        <div className="form">
          <label className="field field-wide">
            <span>{T.home.name}</span>
            <input value={room.name} placeholder={T.home.namePh} maxLength={60} autoComplete="off" onChange={(e) => set("name", e.target.value)} />
          </label>
          {FIELDS.map((k) => {
            const bad = room[k].trim() !== "" && parseMeters(room[k]) === null;
            const id = `err-${k}`;
            return (
              <label className="field" key={k}>
                <span>{T.home[k]}</span>
                <input
                  inputMode="decimal"
                  value={room[k]}
                  placeholder="0"
                  autoComplete="off"
                  aria-invalid={bad}
                  aria-describedby={bad ? id : undefined}
                  onChange={(e) => set(k, e.target.value)}
                />
                {bad && <span id={id} className="field-err">{T.home.invalid}</span>}
              </label>
            );
          })}
        </div>
        {volume !== null && (
          <div className="derived" role="status">
            <p>{T.home.volume(fmt1(volume))}</p>
            <p>{target === null ? T.home.noTarget : T.home.target(fmt2(target))}</p>
          </div>
        )}
        <p className="muted small">{T.home.targetHelp}</p>
      </section>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onStart}>{T.home.start}</button>
      </div>
    </>
  );
}
