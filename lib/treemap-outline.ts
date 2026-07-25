export type OutlineNode = {
  title: string;
  children: OutlineNode[];
};

type OutlineLine = {
  title: string;
  level: number;
  isBullet: boolean;
  isHeading: boolean;
};

const BULLET_PATTERN =
  /^(\s*)(?:[-*+•・▪◦]|(?:\d{1,3}[.)])|[①-⑳])\s+/u;
const HEADING_PATTERN = /^(\s*)(#{1,6})\s+(.+)$/u;

function indentLevel(value: string) {
  const width = value.replace(/\t/g, "  ").length;
  return Math.max(0, Math.floor(width / 2));
}

function toLine(raw: string): OutlineLine | null {
  if (!raw.trim()) return null;

  const heading = raw.match(HEADING_PATTERN);
  if (heading) {
    return {
      title: heading[3].trim().slice(0, 120),
      level: heading[2].length - 1,
      isBullet: false,
      isHeading: true,
    };
  }

  const bullet = raw.match(BULLET_PATTERN);
  const leading = raw.match(/^\s*/u)?.[0] || "";
  const title = bullet ? raw.slice(bullet[0].length) : raw.slice(leading.length);

  return {
    title: title.trim().slice(0, 120),
    level: indentLevel(leading),
    isBullet: Boolean(bullet),
    isHeading: false,
  };
}

export function parseOutlineText(value: string): OutlineNode {
  const lines = value
    .split(/\r?\n/u)
    .map(toLine)
    .filter((line): line is OutlineLine => Boolean(line?.title))
    .slice(0, 500);

  if (!lines.length) {
    throw new Error("文章を入力してください。");
  }

  const first = lines[0];
  const hasExplicitRoot =
    (first.isHeading && first.level === 0) ||
    (!first.isBullet && first.level === 0);
  const root: OutlineNode = {
    title: hasExplicitRoot ? first.title : "新しいテーマ",
    children: [],
  };
  const stack: Array<{ level: number; node: OutlineNode }> = [
    { level: 0, node: root },
  ];
  const content = hasExplicitRoot ? lines.slice(1) : lines;

  for (const line of content) {
    const desiredLevel = line.isHeading
      ? Math.max(1, line.level)
      : Math.max(1, line.level + 1);
    const node: OutlineNode = { title: line.title, children: [] };

    while (
      stack.length > 1 &&
      stack[stack.length - 1].level >= desiredLevel
    ) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]?.node || root;
    parent.children.push(node);
    stack.push({ level: desiredLevel, node });
  }

  return root;
}

export function countOutlineNodes(root: OutlineNode) {
  let count = 0;
  const walk = (node: OutlineNode) => {
    count += 1;
    node.children.forEach(walk);
  };
  walk(root);
  return count;
}
