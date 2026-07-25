"use client";

import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Connection,
  ControlButton,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowInstance,
  applyNodeChanges,
} from "@xyflow/react";
import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EMPTY_TREEMAP,
  TreemapDocument,
  TreemapNode,
  TreemapNodeData,
  TreemapRecord,
} from "@/lib/treemap";
import {
  countOutlineNodes,
  OutlineNode,
  parseOutlineText,
} from "@/lib/treemap-outline";

type Mode = "view" | "edit";
type FlowNode = Node<TreemapNodeData, "treemap">;
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type ImportMode = "add" | "replace";
type OutlineMethod = "indent" | "ai";

const API_ROOT = "/api/treemap";
const MAP_SLUG = "default";
const HISTORY_LIMIT = 50;
const OUTLINE_SAMPLE = `新しいサービス
  誰に届けるか
    30代の会社員
    小さな事業者
  作るもの
    紹介ページ
    問い合わせ導線
  最初の一歩
    内容を整理する
    公開日を決める`;

function safeExternalUrl(value: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function toFlowNodes(nodes: TreemapNode[]): FlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    position: node.position,
    type: "treemap",
    data: node.data,
  }));
}

function toDocumentNodes(nodes: FlowNode[]): TreemapNode[] {
  return nodes.map(({ id, position, data }) => ({
    id,
    position: { x: position.x, y: position.y },
    data: {
      title: String(data.title || "").slice(0, 120),
      note: String(data.note || "").slice(0, 500),
      parentId:
        typeof data.parentId === "string" && data.parentId
          ? data.parentId
          : null,
      collapsed: Boolean(data.collapsed),
      ...(typeof data.imageId === "string" && data.imageId
        ? { imageId: data.imageId }
        : {}),
      ...(typeof data.imageUrl === "string" && data.imageUrl
        ? { imageUrl: data.imageUrl }
        : {}),
      ...(safeExternalUrl(String(data.href || ""))
        ? { href: safeExternalUrl(String(data.href || "")) }
        : {}),
    },
  }));
}

function visibleNodeIds(nodes: FlowNode[], rootId: string) {
  const byParent = new Map<string | null, FlowNode[]>();
  for (const node of nodes) {
    const parentId =
      typeof node.data.parentId === "string" ? node.data.parentId : null;
    byParent.set(parentId, [...(byParent.get(parentId) || []), node]);
  }

  const visible = new Set<string>();
  const walk = (id: string) => {
    if (visible.has(id)) return;
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    visible.add(id);
    if (node.data.collapsed) return;
    for (const child of byParent.get(id) || []) walk(child.id);
  };
  walk(rootId);
  return visible;
}

function makeEdges(nodes: FlowNode[], visible: Set<string>): Edge[] {
  return nodes.flatMap((node) => {
    const parentId =
      typeof node.data.parentId === "string" ? node.data.parentId : null;
    if (!parentId || !visible.has(parentId) || !visible.has(node.id)) return [];
    return [
      {
        id: `${parentId}-${node.id}`,
        source: parentId,
        target: node.id,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#115e59", strokeWidth: 3.5 },
      },
    ];
  });
}

function layoutFlowNodes(nodes: FlowNode[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 45, ranksep: 90 });
  nodes.forEach((node) => graph.setNode(node.id, { width: 270, height: 130 }));
  nodes.forEach((node) => {
    if (typeof node.data.parentId === "string") {
      graph.setEdge(node.data.parentId, node.id);
    }
  });
  dagre.layout(graph);
  return nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      ...node,
      position: { x: point.x - 135, y: point.y - 65 },
    };
  });
}

function outlineToFlowNodes(
  outline: OutlineNode,
  options: { rootId?: string; parentId?: string | null } = {},
) {
  const result: FlowNode[] = [];
  const walk = (
    item: OutlineNode,
    parentId: string | null,
    forcedId?: string,
  ) => {
    const id = forcedId || crypto.randomUUID();
    result.push({
      id,
      type: "treemap",
      position: { x: 0, y: 0 },
      data: {
        title: item.title,
        note: "",
        parentId,
        collapsed: false,
      },
    });
    item.children.forEach((child) => walk(child, id));
    return id;
  };
  const rootId = walk(
    outline,
    options.parentId ?? null,
    options.rootId,
  );
  return { rootId, nodes: result };
}

function OutlinePreview({ node }: { node: OutlineNode }) {
  return (
    <li>
      <span>{node.title}</span>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <OutlinePreview
              key={`${child.title}-${index}`}
              node={child}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreemapCard({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const editable = Boolean(data._editable);
  const childCount = Number(data._childCount || 0);
  const onToggle = data._onToggle as (() => void) | undefined;
  const onImage = data._onImage as (() => void) | undefined;

  return (
    <article className={`treemap-node ${selected ? "is-selected" : ""}`}>
      {id !== "root" && (
        <Handle
          type="target"
          position={Position.Left}
          className="treemap-handle"
          isConnectable={editable}
        />
      )}
      {data.imageUrl && (
        <button
          type="button"
          className="treemap-node-image"
          onClick={(event) => {
            event.stopPropagation();
            onImage?.();
          }}
          aria-label={`${data.title}の画像を拡大`}
        >
          <img src={String(data.imageUrl)} alt="" draggable={false} />
        </button>
      )}
      <div className="treemap-node-body">
        <h2>{String(data.title)}</h2>
        {data.note && <p>{String(data.note)}</p>}
        <div className="treemap-node-actions">
          {data.href && (
            <a
              href={String(data.href)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              開く ↗
            </a>
          )}
          {childCount > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle?.();
              }}
            >
              {data.collapsed ? `＋ ${childCount}` : "枝を閉じる"}
            </button>
          )}
        </div>
      </div>
      {(editable || childCount > 0) && (
        <Handle
          type="source"
          position={Position.Right}
          className="treemap-handle"
          isConnectable={editable}
        />
      )}
      <span className="treemap-node-id" aria-hidden="true">
        {id === "root" ? "ROOT" : ""}
      </span>
    </article>
  );
}

const nodeTypes = { treemap: TreemapCard };

async function resizeImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("JPEG・PNG・WebPだけアップロードできます。");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("画像は5MB以下にしてください。");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.86),
  );
  return blob
    ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
        type: "image/webp",
      })
    : file;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`${API_ROOT}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error("パスワードが違います。");
      setPassword("");
      onSuccess();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログインできません。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="treemap-login-shell">
      <a href="/" className="treemap-brand">
        <span>思考マップ</span>
      </a>
      <form className="treemap-login-card" onSubmit={submit}>
        <span className="treemap-eyebrow">OWNER LOGIN</span>
        <h1>編集画面を開く</h1>
        <p>編集パスワードを入力してください。</p>
        <input
          className="treemap-visually-hidden"
          type="text"
          name="username"
          autoComplete="username"
          value="owner"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <label>
          パスワード
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {message && <p className="treemap-error">{message}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "確認中…" : "編集を始める"}
        </button>
      </form>
    </main>
  );
}

export function TreemapApp({ mode }: { mode: Mode }) {
  const [record, setRecord] = useState<TreemapRecord | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>(
    toFlowNodes(EMPTY_TREEMAP.nodes),
  );
  const [selectedId, setSelectedId] = useState<string | null>("root");
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [past, setPast] = useState<FlowNode[][]>([]);
  const [future, setFuture] = useState<FlowNode[][]>([]);
  const [lightbox, setLightbox] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mobileEditorWarning, setMobileEditorWarning] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineText, setOutlineText] = useState(OUTLINE_SAMPLE);
  const [importMode, setImportMode] = useState<ImportMode>("add");
  const [outlineMethod, setOutlineMethod] =
    useState<OutlineMethod>("indent");
  const [aiOutline, setAiOutline] = useState<OutlineNode | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState("");
  const flowRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const dragSnapshot = useRef<FlowNode[] | null>(null);
  const nodesRef = useRef(nodes);

  const fitAll = useCallback(() => {
    flowRef.current?.fitView({ padding: 0.25, duration: 280 });
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const manualOutline = useMemo(() => {
    try {
      const outline = parseOutlineText(outlineText);
      return {
        outline,
        count: countOutlineNodes(outline),
        error: "",
      };
    } catch (error) {
      return {
        outline: null,
        count: 0,
        error:
          error instanceof Error
            ? error.message
            : "文章を読み取れませんでした。",
      };
    }
  }, [outlineText]);
  const parsedOutline =
    outlineMethod === "ai"
      ? {
          outline: aiOutline,
          count: aiOutline ? countOutlineNodes(aiOutline) : 0,
          error:
            aiError ||
            (aiOutline ? "" : "「AIで整理する」を押すとプレビューが表示されます。"),
        }
      : manualOutline;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      if (mode === "edit") {
        const sessionResponse = await fetch(`${API_ROOT}/session`, {
          cache: "no-store",
        });
        const session = (await sessionResponse.json()) as {
          authenticated?: boolean;
        };
        if (!session.authenticated) {
          setUnauthorized(true);
          return;
        }
      }
      const route =
        mode === "edit" ? `admin/${MAP_SLUG}` : `public/${MAP_SLUG}`;
      const response = await fetch(`${API_ROOT}/${route}`, {
        cache: "no-store",
      });
      if (response.status === 401 && mode === "edit") {
        setUnauthorized(true);
        return;
      }
      if (!response.ok) throw new Error("思考マップを読み込めませんでした。");
      const next = (await response.json()) as TreemapRecord;
      setRecord(next);
      setNodes(toFlowNodes(next.document.nodes));
      setSelectedId(next.document.rootId);
      setPast([]);
      setFuture([]);
      setSaveState("idle");
      setUnauthorized(false);
      requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.25 }));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "読み込みに失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (mode !== "edit") return;
    const check = () => setMobileEditorWarning(window.innerWidth < 800);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [mode]);

  const rootId = record?.document.rootId || EMPTY_TREEMAP.rootId;
  const visible = useMemo(
    () => visibleNodeIds(nodes, rootId),
    [nodes, rootId],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((node) => {
      if (typeof node.data.parentId === "string") {
        counts.set(
          node.data.parentId,
          (counts.get(node.data.parentId) || 0) + 1,
        );
      }
    });
    return counts;
  }, [nodes]);

  const toggleCollapsed = useCallback((id: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === id
          ? {
              ...node,
              data: { ...node.data, collapsed: !node.data.collapsed },
            }
          : node,
      ),
    );
    if (mode === "edit") setSaveState("dirty");
  }, [mode]);

  const renderedNodes = useMemo<FlowNode[]>(
    () =>
      nodes
        .filter((node) => visible.has(node.id))
        .map((node) => ({
          ...node,
          data: {
            ...node.data,
            _editable: mode === "edit",
            _childCount: childCounts.get(node.id) || 0,
            _onToggle: () => toggleCollapsed(node.id),
            _onImage: () => {
              if (node.data.imageUrl) {
                setLightbox(String(node.data.imageUrl));
              }
            },
          },
        })),
    [nodes, visible, childCounts, mode, toggleCollapsed],
  );
  const edges = useMemo(() => makeEdges(nodes, visible), [nodes, visible]);
  const selected = nodes.find((node) => node.id === selectedId) || null;

  const remember = useCallback((snapshot: FlowNode[]) => {
    setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    setFuture([]);
  }, []);

  const commit = useCallback(
    (updater: (current: FlowNode[]) => FlowNode[]) => {
      setNodes((current) => {
        remember(current);
        return updater(current);
      });
      setSaveState("dirty");
    },
    [remember],
  );

  const undo = useCallback(() => {
    setPast((items) => {
      if (!items.length) return items;
      const previous = items[items.length - 1];
      setFuture((next) => [nodesRef.current, ...next].slice(0, HISTORY_LIMIT));
      setNodes(previous);
      setSaveState("dirty");
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      if (!items.length) return items;
      const next = items[0];
      setPast((previous) =>
        [...previous, nodesRef.current].slice(-HISTORY_LIMIT),
      );
      setNodes(next);
      setSaveState("dirty");
      return items.slice(1);
    });
  }, []);

  useEffect(() => {
    if (mode !== "edit") return;
    const listener = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [mode, redo, undo]);

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      fitAll();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [fitAll]);

  useEffect(() => {
    if (!outlineOpen) return;
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOutlineOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [outlineOpen]);

  useEffect(() => {
    if (mode !== "edit" || saveState !== "dirty" || !record) return;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const document: TreemapDocument = {
          rootId,
          nodes: toDocumentNodes(nodesRef.current),
        };
        const response = await fetch(`${API_ROOT}/admin/${MAP_SLUG}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: record.title,
            version: record.version,
            document,
          }),
        });
        if (response.status === 409) {
          setSaveState("conflict");
          return;
        }
        if (!response.ok) throw new Error();
        const saved = (await response.json()) as TreemapRecord;
        setRecord(saved);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [mode, saveState, record, rootId]);

  function addNode(kind: "child" | "sibling") {
    const current = selected || nodes.find((node) => node.id === rootId);
    if (!current) return;
    const parentId =
      kind === "sibling" && current.id !== rootId
        ? (current.data.parentId as string | null)
        : current.id;
    if (!parentId) return;
    const parent = nodes.find((node) => node.id === parentId) || current;
    const id = crypto.randomUUID();
    const siblings = nodes.filter((node) => node.data.parentId === parentId);
    commit((items) => [
      ...items.map((node) =>
        node.id === parentId
          ? { ...node, data: { ...node.data, collapsed: false } }
          : node,
      ),
      {
        id,
        type: "treemap",
        position: {
          x: parent.position.x + 330,
          y: parent.position.y + siblings.length * 150,
        },
        data: {
          title: "新しいテーマ",
          note: "",
          parentId,
          collapsed: false,
        },
      },
    ]);
    setSelectedId(id);
  }

  function descendantsOf(id: string) {
    const result = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach((node) => {
        if (
          typeof node.data.parentId === "string" &&
          result.has(node.data.parentId) &&
          !result.has(node.id)
        ) {
          result.add(node.id);
          changed = true;
        }
      });
    }
    return result;
  }

  function removeSelected() {
    if (!selected || selected.id === rootId) return;
    if (!window.confirm("この枝と、その下の項目を削除しますか？")) return;
    const ids = descendantsOf(selected.id);
    const assets = nodes
      .filter((node) => ids.has(node.id))
      .map((node) => node.data.imageId)
      .filter((id): id is string => typeof id === "string");
    commit((items) => items.filter((node) => !ids.has(node.id)));
    setSelectedId(selected.data.parentId as string);
    assets.forEach((id) => {
      fetch(`${API_ROOT}/admin/${MAP_SLUG}/assets/${id}`, {
        method: "DELETE",
      }).catch(() => undefined);
    });
  }

  function updateSelected(patch: Partial<TreemapNodeData>) {
    if (!selectedId) return;
    setNodes((items) =>
      items.map((node) =>
        node.id === selectedId
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    );
    setSaveState("dirty");
  }

  function createsCycle(parentId: string, childId: string) {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === childId) return true;
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      const parent = nodes.find((node) => node.id === cursor);
      cursor =
        parent && typeof parent.data.parentId === "string"
          ? parent.data.parentId
          : null;
    }
    return false;
  }

  const connect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        connection.target === rootId ||
        createsCycle(connection.source, connection.target)
      )
        return;
      commit((items) =>
        items.map((node) =>
          node.id === connection.target
            ? {
                ...node,
                data: { ...node.data, parentId: connection.source },
              }
            : node.id === connection.source
              ? { ...node, data: { ...node.data, collapsed: false } }
              : node,
        ),
      );
    },
    [commit, nodes, rootId],
  );

  function autoLayout() {
    commit((items) => layoutFlowNodes(items));
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2 }));
  }

  async function organizeWithAI() {
    if (!outlineText.trim() || aiPending) return;
    setAiPending(true);
    setAiError("");
    setAiOutline(null);
    try {
      const response = await fetch(
        `${API_ROOT}/admin/${MAP_SLUG}/outline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: outlineText }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        outline?: OutlineNode;
        error?: string;
      } | null;
      if (!response.ok || !body?.outline) {
        throw new Error(body?.error || "AIで文章を整理できませんでした。");
      }
      setAiOutline(body.outline);
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "AIで文章を整理できませんでした。",
      );
    } finally {
      setAiPending(false);
    }
  }

  function applyOutline() {
    if (!parsedOutline.outline) return;
    if (
      importMode === "replace" &&
      !window.confirm("現在のマップを、入力した内容で置き換えますか？")
    ) {
      return;
    }

    if (importMode === "replace") {
      const imported = outlineToFlowNodes(parsedOutline.outline, {
        rootId: "root",
      });
      commit(() => layoutFlowNodes(imported.nodes));
      setSelectedId(imported.rootId);
    } else {
      const parent =
        selected || nodes.find((node) => node.id === rootId) || null;
      if (!parent) return;
      const imported = outlineToFlowNodes(parsedOutline.outline, {
        parentId: parent.id,
      });
      commit((items) =>
        layoutFlowNodes([
          ...items.map((node) =>
            node.id === parent.id
              ? {
                  ...node,
                  data: { ...node.data, collapsed: false },
                }
              : node,
          ),
          ...imported.nodes,
        ]),
      );
      setSelectedId(imported.rootId);
    }

    setOutlineOpen(false);
    requestAnimationFrame(fitAll);
  }

  async function uploadImage(file: File) {
    if (!selected) return;
    setUploading(true);
    try {
      const prepared = await resizeImage(file);
      const form = new FormData();
      form.append("file", prepared);
      const response = await fetch(
        `${API_ROOT}/admin/${MAP_SLUG}/assets`,
        { method: "POST", body: form },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "画像を保存できませんでした。");
      }
      const asset = (await response.json()) as { id: string; url: string };
      const previousId = selected.data.imageId;
      updateSelected({ imageId: asset.id, imageUrl: asset.url });
      if (typeof previousId === "string") {
        fetch(`${API_ROOT}/admin/${MAP_SLUG}/assets/${previousId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "画像を追加できませんでした。",
      );
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    if (!selected || typeof selected.data.imageId !== "string") return;
    const id = selected.data.imageId;
    updateSelected({ imageId: undefined, imageUrl: undefined });
    await fetch(`${API_ROOT}/admin/${MAP_SLUG}/assets/${id}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!selected || !event.dataTransfer.files[0]) return;
    event.preventDefault();
    uploadImage(event.dataTransfer.files[0]);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      uploadImage(file);
    }
  }

  if (unauthorized && mode === "edit") return <Login onSuccess={load} />;

  return (
    <main
      className="treemap-shell"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onPaste={handlePaste}
    >
      <header className="treemap-header">
        <a href="/" className="treemap-brand">
          <span>思考マップ</span>
        </a>
        <div className="treemap-header-actions">
          {mode === "edit" ? (
            <>
              <span className={`treemap-save-state is-${saveState}`}>
                {saveState === "dirty" && "未保存"}
                {saveState === "saving" && "保存中…"}
                {saveState === "saved" && "保存済み"}
                {saveState === "error" && "保存失敗"}
                {saveState === "conflict" && "別画面で更新されています"}
                {saveState === "idle" && "編集できます"}
              </span>
              {(saveState === "error" || saveState === "conflict") && (
                <button type="button" onClick={load}>
                  再読込
                </button>
              )}
              <a href="/">公開画面</a>
            </>
          ) : (
            <a href="/edit/" className="treemap-edit-link">
              編集
            </a>
          )}
        </div>
      </header>

      {mobileEditorWarning && (
        <div className="treemap-mobile-warning">
          編集はPCがおすすめです。スマホでは公開画面の閲覧をご利用ください。
        </div>
      )}

      {mode === "edit" && (
        <nav className="treemap-toolbar" aria-label="編集ツール">
          <button type="button" onClick={() => addNode("child")}>
            ＋ 子を追加
          </button>
          <button
            type="button"
            onClick={() => addNode("sibling")}
            disabled={!selected || selected.id === rootId}
          >
            ＋ 兄弟を追加
          </button>
          <button type="button" onClick={() => setOutlineOpen(true)}>
            文章から作る
          </button>
          <button
            type="button"
            onClick={removeSelected}
            disabled={!selected || selected.id === rootId}
          >
            削除
          </button>
          <span />
          <button type="button" onClick={undo} disabled={!past.length}>
            ↶ 戻す
          </button>
          <button type="button" onClick={redo} disabled={!future.length}>
            ↷ やり直す
          </button>
          <button type="button" onClick={autoLayout}>
            ✨ 自動整列
          </button>
        </nav>
      )}

      <section className="treemap-workspace">
        <div className="treemap-canvas">
          {loading && <div className="treemap-status">読み込み中…</div>}
          {loadError && (
            <div className="treemap-status is-error">
              <p>{loadError}</p>
              <button type="button" onClick={load}>
                もう一度試す
              </button>
            </div>
          )}
          {!loading && !loadError && (
            <ReactFlow
              nodes={renderedNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={mode === "edit"}
              nodesConnectable={mode === "edit"}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.2}
              maxZoom={2}
              onInit={(instance) => {
                flowRef.current = instance;
              }}
              onNodesChange={(changes: NodeChange<FlowNode>[]) => {
                const meaningful = changes.some(
                  (change) => change.type === "position",
                );
                setNodes((items) => applyNodeChanges(changes, items));
                if (mode === "edit" && meaningful) setSaveState("dirty");
              }}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onNodeDragStart={() => {
                dragSnapshot.current = nodesRef.current;
              }}
              onNodeDragStop={() => {
                if (dragSnapshot.current) remember(dragSnapshot.current);
                dragSnapshot.current = null;
                setSaveState("dirty");
              }}
              onConnect={connect}
              onPaneClick={() => mode === "view" && setSelectedId(null)}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1.8}
                color="#64748b"
              />
              <Controls showInteractive={false} showFitView={false}>
                <ControlButton
                  onClick={fitAll}
                  title="全体表示・中央へ戻す（F）"
                  aria-label="全体表示・中央へ戻す。ショートカットはFキー"
                >
                  F
                </ControlButton>
              </Controls>
              <MiniMap
                pannable
                zoomable
                nodeColor="#115e59"
                maskColor="rgba(248,250,252,.78)"
              />
            </ReactFlow>
          )}
        </div>

        {mode === "edit" && selected && (
          <aside className="treemap-inspector">
            <span className="treemap-eyebrow">SELECTED NODE</span>
            <label>
              タイトル
              <input
                value={String(selected.data.title)}
                maxLength={120}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateSelected({ title: event.target.value })
                }
              />
            </label>
            <label>
              メモ
              <textarea
                value={String(selected.data.note || "")}
                maxLength={500}
                rows={5}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  updateSelected({ note: event.target.value })
                }
              />
            </label>
            <label>
              リンク
              <input
                type="url"
                placeholder="https://..."
                value={String(selected.data.href || "")}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateSelected({ href: event.target.value })
                }
              />
            </label>
            <div className="treemap-image-field">
              <span>画像</span>
              {selected.data.imageUrl ? (
                <>
                  <img src={String(selected.data.imageUrl)} alt="" />
                  <button type="button" onClick={removeImage}>
                    画像を外す
                  </button>
                </>
              ) : (
                <label className="treemap-upload">
                  {uploading
                    ? "アップロード中…"
                    : "画像を選択・ドロップ・貼り付け"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) uploadImage(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            <p className="treemap-help">
              ノード右の点から別ノードへつなぐと、親子関係を変更できます。
            </p>
          </aside>
        )}
      </section>

      {outlineOpen && (
        <div
          className="treemap-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setOutlineOpen(false)}
        >
          <section
            className="treemap-outline-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="treemap-outline-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="treemap-dialog-heading">
              <div>
                <span className="treemap-eyebrow">TEXT TO TREE</span>
                <h2 id="treemap-outline-title">文章からマップを作る</h2>
              </div>
              <button
                type="button"
                className="treemap-dialog-close"
                onClick={() => setOutlineOpen(false)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className="treemap-outline-method" aria-label="変換方法">
              <button
                type="button"
                className={outlineMethod === "indent" ? "is-active" : ""}
                onClick={() => setOutlineMethod("indent")}
              >
                字下げをそのまま使う
              </button>
              <button
                type="button"
                className={outlineMethod === "ai" ? "is-active" : ""}
                onClick={() => setOutlineMethod("ai")}
              >
                AIに整理してもらう
              </button>
            </div>

            <p className="treemap-outline-help">
              {outlineMethod === "indent"
                ? "1行目を中心テーマにし、半角スペース2つまたはTabで字下げしてください。箇条書きやMarkdown見出しにも対応します。"
                : "メモや文章をそのまま貼り付けてください。AIが内容を足さず、中心テーマと枝へ整理します。"}
            </p>

            <div className="treemap-outline-grid">
              <div className="treemap-outline-input">
                <label htmlFor="treemap-outline-text">入力</label>
                <textarea
                  id="treemap-outline-text"
                  value={outlineText}
                  onChange={(event) => {
                    setOutlineText(event.target.value);
                    setAiOutline(null);
                    setAiError("");
                  }}
                  rows={14}
                  spellCheck={false}
                />
                {outlineMethod === "ai" && (
                  <button
                    type="button"
                    className="treemap-ai-organize"
                    onClick={organizeWithAI}
                    disabled={!outlineText.trim() || aiPending}
                  >
                    {aiPending ? "AIが整理中…" : "AIで整理する"}
                  </button>
                )}
              </div>

              <div className="treemap-outline-preview">
                <div className="treemap-outline-preview-heading">
                  <span>プレビュー</span>
                  <small>{parsedOutline.count}項目</small>
                </div>
                {parsedOutline.outline ? (
                  <ul className="treemap-outline-tree">
                    <OutlinePreview node={parsedOutline.outline} />
                  </ul>
                ) : (
                  <p
                    className={
                      aiError ? "treemap-error" : "treemap-outline-empty"
                    }
                  >
                    {parsedOutline.error}
                  </p>
                )}
              </div>
            </div>

            <fieldset className="treemap-import-mode">
              <legend>作り方</legend>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  value="add"
                  checked={importMode === "add"}
                  onChange={() => setImportMode("add")}
                />
                選択中の項目へ追加
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                />
                現在のマップを置き換える
              </label>
            </fieldset>

            <div className="treemap-dialog-actions">
              <button type="button" onClick={() => setOutlineOpen(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={applyOutline}
                disabled={!parsedOutline.outline}
              >
                この内容で作る
              </button>
            </div>
          </section>
        </div>
      )}

      {lightbox && (
        <button
          type="button"
          className="treemap-lightbox"
          onClick={() => setLightbox("")}
          aria-label="画像を閉じる"
        >
          <img src={lightbox} alt="" />
          <span>×</span>
        </button>
      )}
    </main>
  );
}
