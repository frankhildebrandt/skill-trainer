/** Middle of two texts after the shared line prefix and suffix, as a short unified snippet. */
export function changedLines(before: string, after: string, limit = 80): string {
  if (before === after) return "";
  const left = before.replace(/\r\n/g, "\n").split("\n");
  const right = after.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let endLeft = left.length - 1;
  let endRight = right.length - 1;
  while (endLeft >= start && endRight >= start && left[endLeft] === right[endRight]) {
    endLeft -= 1;
    endRight -= 1;
  }
  const lines = [
    ...left.slice(start, endLeft + 1).map((line) => `- ${line}`),
    ...right.slice(start, endRight + 1).map((line) => `+ ${line}`),
  ];
  if (lines.length <= limit) return lines.join("\n");
  return `${lines.slice(0, limit).join("\n")}\n…`;
}
