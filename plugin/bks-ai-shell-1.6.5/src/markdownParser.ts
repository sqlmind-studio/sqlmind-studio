import { Marked, Renderer } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import { getAppVersion } from "@sqlmindstudio/plugin";

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

const renderer = new Renderer();

let copyCounter = 0;

function encodeForAttr(text: string): string {
  try {
    // Keep newlines and avoid breaking HTML attributes.
    return encodeURIComponent(String(text ?? '').replace(/\r\n/g, '\n'));
  } catch {
    return '';
  }
}

function extractRawCodeFromMarkedToken(token: any): string {
  try {
    const raw = typeof token?.raw === 'string' ? token.raw : '';
    if (raw) {
      // Fenced code block: ```lang\n<code>\n```
      const m = raw.match(/^```[^\n]*\n([\s\S]*?)\n```\s*$/);
      if (m && typeof m[1] === 'string') {
        return String(m[1]).replace(/\r\n/g, '\n');
      }
      // Indented code or other formats: best-effort fall back to raw.
      return raw.replace(/\r\n/g, '\n');
    }

    const text = typeof token?.text === 'string' ? token.text : '';
    // If marked-highlight already injected HTML, strip tags.
    const withoutTags = text.replace(/<[^>]+>/g, '');
    return withoutTags.replace(/\r\n/g, '\n');
  } catch {
    return '';
  }
}

export function formatSqlForDisplay(input: string): string {
  const raw = String(input || '');
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  const normalized = trimmed.replace(/\r\n/g, '\n');
  const lineCount = normalized.split('\n').filter(l => l.trim().length > 0).length;
  const hasIndent = /^\s{2,}\S/m.test(normalized);
  if (lineCount > 6 || hasIndent) return normalized;

  let s = normalized;
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*;\s*$/g, ';');

  const nl = (kw: string) => new RegExp(`\\s+(${kw})\\b`, 'ig');
  s = s.replace(nl('FROM'), '\nFROM');
  s = s.replace(nl('WHERE'), '\nWHERE');
  s = s.replace(nl('GROUP\\s+BY'), '\nGROUP BY');
  s = s.replace(nl('HAVING'), '\nHAVING');
  s = s.replace(nl('ORDER\\s+BY'), '\nORDER BY');
  s = s.replace(nl('UNION\\s+ALL'), '\nUNION ALL');
  s = s.replace(nl('UNION'), '\nUNION');
  s = s.replace(nl('EXCEPT'), '\nEXCEPT');
  s = s.replace(nl('INTERSECT'), '\nINTERSECT');

  s = s.replace(/\s+(INNER\s+JOIN|LEFT\s+JOIN|LEFT\s+OUTER\s+JOIN|RIGHT\s+JOIN|RIGHT\s+OUTER\s+JOIN|FULL\s+JOIN|FULL\s+OUTER\s+JOIN|CROSS\s+JOIN|JOIN)\b/ig, '\n$1');
  s = s.replace(/\s+(CROSS\s+APPLY|OUTER\s+APPLY)\b/ig, '\n$1');
  s = s.replace(/\s+(ON)\b/ig, '\n  ON');

  s = s.replace(/\bSELECT\b\s+/i, 'SELECT\n  ');
  s = s.replace(/,\s*/g, ',\n  ');
  s = s.replace(/\nWHERE\b\s+/i, '\nWHERE\n  ');
  s = s.replace(/\nGROUP BY\b\s+/i, '\nGROUP BY\n  ');
  s = s.replace(/\nORDER BY\b\s+/i, '\nORDER BY\n  ');
  s = s.replace(/\nHAVING\b\s+/i, '\nHAVING\n  ');

  return s.trim();
}

async function useExtensions() {
  const appVersion = await getAppVersion();
  console.log('[markdownParser] App version:', appVersion);
  const supportOpenInQueryEditor = appVersion !== "5.3";
  console.log('[markdownParser] Support open in query editor:', supportOpenInQueryEditor);
  marked.use({
    renderer: {
      table(...args) {
        return `<div class="table-container">${renderer.table.apply(this, args)}</div>`;
      },
    },
    extensions: [
      {
        name: "code",
        renderer(token) {
          let className = "hljs";
          let langAttr = "";
          const codeId = "code-" + copyCounter++;

          if (token.lang) {
            className += ` language-${token.lang}`;
            langAttr = ` data-lang="${token.lang}"`;
          }

          const queryOrCode = token.lang === "sql" ? "query" : "code";

          const rawSql = token.lang === 'sql' ? extractRawCodeFromMarkedToken(token) : '';
          const isHighlightedHtml = typeof token.text === 'string' && /<span\b[^>]*\bhljs-/i.test(token.text);
          const codeText = token.lang === 'sql'
            ? (isHighlightedHtml ? token.text : formatSqlForDisplay(rawSql || token.text))
            : token.text;
          const rawAttr = token.lang === 'sql' ? ` data-raw="${encodeForAttr(rawSql)}"` : '';

          let actionsHtml = `
            <button
              class="btn btn-flat-2"
              ${supportOpenInQueryEditor ? "" : "disabled"}
              data-action="open-in-query-editor"
              data-action-target="${codeId}"
            >
              <span class="material-symbols-outlined">open_in_new</span>
              <span class="title-popup">
                Open in query editor
                ${supportOpenInQueryEditor ? "" : "<br>(requires SQLMind Studio 5.4+)"}
              </span>
            </button>
            <button
              class="btn btn-flat-2"
              data-action="copy"
              data-action-target="${codeId}"
            >
              <span class="material-symbols-outlined copy-icon">content_copy</span>
              <span class="material-symbols-outlined copied-icon">check</span>
              <span>Copy ${queryOrCode}</span>
              <span class="title-popup">
                <span class="copy-label">Copy ${queryOrCode}</span>
                <span class="copied-label">Copied</span>
              </span>
            </button>
          `;

          // if (token.lang === "sql") {
          //   actionsHtml += `
          //     <button
          //       class="btn copy-btn"
          //       data-action="run"
          //       data-action-target="${codeId}"
          //     >
          //       <span class="material-symbols-outlined">play_arrow</span>
          //       Run
          //     </button>
          //   `;
          // }

          return `
            <div class="code-block">
              <div class="lang">${token.lang || ""}</div>
              <div class="actions">
                <div class="group">${actionsHtml}</div>
              </div>
              <pre><code id="${codeId}" class="${className}"${langAttr}${rawAttr}>${codeText}</code></pre>
            </div>
          `;
        },
      },
    ],
  });
}

useExtensions();

export function parseMarkdownToHTML(document: string): string {
  return marked.parse(document, { async: false });
}
