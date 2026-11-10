// When a question inside a video is due. Pure, so it is tested on its own.
export const JUMP = 3; // seconds: a bigger step between two reads means you scrubbed, not watched
// The first question you moved past since the last read (`last`) that isn't answered yet, or -1.
// Returns { k, seekTo }: seekTo is set when you scrubbed past it, so the video goes back to the question.
export function dueCheck(list, last, t, asked) {
  if (last == null) return { k: -1 };
  const k = list.findIndex((c, i) => !asked(i) && last < c.t && c.t <= t + 0.3);
  if (k < 0) return { k };
  return { k, seekTo: t - list[k].t > JUMP ? list[k].t : null };
}
