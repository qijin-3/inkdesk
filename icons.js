/**
 * Lucide 图标：输出内联 SVG 字符串，供模板插入。
 */
import {
  Settings,
  LayoutDashboard,
  Sparkles,
  Library,
  CircleUser,
  Plus,
  ImagePlus,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  Quote,
  ListTree,
  Focus,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  X,
  PanelRightOpen,
  PanelRightClose,
  SendHorizontal,
  Upload,
  AtSign,
  Tags,
  Eye,
  WandSparkles,
  SearchCheck,
  Pin,
  PinOff,
  FileText,
  Link2,
} from "lucide";

/**
 * 将 Lucide IconNode 序列化为 SVG HTML。
 * @param {import('lucide').IconNode} node
 * @param {{ size?: number, stroke?: number, className?: string }} [opts]
 */
export function icon(node, opts = {}) {
  const size = opts.size ?? 16;
  const stroke = opts.stroke ?? 1.75;
  const cls = opts.className ? ` ${opts.className}` : "";
  const body = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs || {})
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" class="lucide${cls}" aria-hidden="true">${body}</svg>`;
}

/** 预设：常用 UI 图标（默认 16） */
export const I = {
  settings: (o) => icon(Settings, o),
  dashboard: (o) => icon(LayoutDashboard, o),
  sparkles: (o) => icon(Sparkles, o),
  library: (o) => icon(Library, o),
  user: (o) => icon(CircleUser, o),
  plus: (o) => icon(Plus, o),
  image: (o) => icon(ImagePlus, o),
  bold: (o) => icon(Bold, o),
  italic: (o) => icon(Italic, o),
  h1: (o) => icon(Heading1, o),
  h2: (o) => icon(Heading2, o),
  list: (o) => icon(List, o),
  quote: (o) => icon(Quote, o),
  outline: (o) => icon(ListTree, o),
  pin: (o) => icon(Pin, o),
  pinOff: (o) => icon(PinOff, o),
  focus: (o) => icon(Focus, o),
  refresh: (o) => icon(RefreshCw, o),
  folder: (o) => icon(FolderOpen, o),
  external: (o) => icon(ExternalLink, o),
  close: (o) => icon(X, o),
  panelOpen: (o) => icon(PanelRightOpen, o),
  panelClose: (o) => icon(PanelRightClose, o),
  send: (o) => icon(SendHorizontal, o),
  upload: (o) => icon(Upload, o),
  at: (o) => icon(AtSign, o),
  tags: (o) => icon(Tags, o),
  eye: (o) => icon(Eye, o),
  wand: (o) => icon(WandSparkles, o),
  check: (o) => icon(SearchCheck, o),
  file: (o) => icon(FileText, o),
  link: (o) => icon(Link2, o),
};
