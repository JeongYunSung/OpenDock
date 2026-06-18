import { type Dock, type Lang, TEXT } from "./data";

export function ReadmePanel(props: { detail: Dock; t: (typeof TEXT)[Lang] }) {
  const readme = parseReadmeMarkdown(props.detail.readmeMarkdown);
  const title = readme.title || props.detail.readmeTitle;
  const intro = readme.intro || props.detail.readmeIntro;
  const description = props.detail.desc?.trim();
  const shouldShowDescription = Boolean(description && description !== intro?.trim());

  return (
    <div className="readme-panel">
      <h2>{props.t.readme}</h2>
      <div className="readme-card">
        <h3>{title}</h3>
        {shouldShowDescription ? <p className="readme-description">{description}</p> : null}
        {intro ? <p>{intro}</p> : null}
        {readme.blocks.length > 0 ? (
          <div className="readme-markdown">
            {readme.blocks.map((block, index) => renderReadmeBlock(block, index))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ReadmeBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; text: string };

function parseReadmeMarkdown(markdown?: string | null) {
  const blocks = markdown ? markdownToBlocks(markdown) : [];
  const [firstBlock, ...rest] = blocks;
  const title = firstBlock?.type === "heading" && firstBlock.level === 1 ? firstBlock.text : "";
  const content = title ? rest : blocks;
  const introIndex = content.findIndex((block) => block.type === "paragraph");
  const intro = introIndex >= 0 && content[introIndex]?.type === "paragraph" ? content[introIndex].text : "";
  const visibleBlocks = content.filter((_, index) => index !== introIndex);

  return { title, intro, blocks: visibleBlocks };
}

function markdownToBlocks(markdown: string): ReadmeBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReadmeBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: code.join("\n").trimEnd() });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: stripInlineMarkdown(heading[2]) });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec((lines[index] ?? "").trim());
        if (!item) break;
        items.push(stripInlineMarkdown(item[1]));
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (!current || current.startsWith("```") || /^(#{1,6})\s+/.test(current) || /^[-*]\s+/.test(current)) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: stripInlineMarkdown(paragraph.join(" ")) });
  }

  return blocks;
}

function renderReadmeBlock(block: ReadmeBlock, index: number) {
  if (block.type === "heading") {
    const HeadingTag = block.level <= 2 ? "h4" : "h5";
    return <HeadingTag key={`${block.type}-${index}`}>{block.text}</HeadingTag>;
  }

  if (block.type === "list") {
    return (
      <ul key={`${block.type}-${index}`}>
        {block.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }

  if (block.type === "code") {
    return <pre key={`${block.type}-${index}`}><code>{block.text}</code></pre>;
  }

  return <p key={`${block.type}-${index}`}>{block.text}</p>;
}

function stripInlineMarkdown(value: string) {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
}
