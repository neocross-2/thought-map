export type TreemapNodeData = {
  title: string;
  note: string;
  parentId: string | null;
  collapsed: boolean;
  imageId?: string;
  imageUrl?: string;
  href?: string;
  [key: string]: unknown;
};

export type TreemapNode = {
  id: string;
  position: { x: number; y: number };
  data: TreemapNodeData;
};

export type TreemapDocument = {
  rootId: string;
  nodes: TreemapNode[];
};

export type TreemapRecord = {
  id: string;
  slug: string;
  title: string;
  version: number;
  updatedAt: string;
  document: TreemapDocument;
};

export const EMPTY_TREEMAP: TreemapDocument = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      position: { x: 80, y: 220 },
      data: {
        title: "思考マップ",
        note: "画像と枝で、考えを育てる。",
        parentId: null,
        collapsed: false,
      },
    },
  ],
};
