// Minimal Markdown → HTML for METHODS.md (headings, paragraphs, lists, tables, bold/italic/code). Input is our own file; still escaped.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Links: http(s) URLs open in a new tab; METHODS.md / README_DATA.md map to the app's own pages; other relative links become plain text.
const link = (t, u) => (/^https?:\/\//.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>`
  : /METHODS\.md$/.test(u) ? `<a href="#about">${t}</a>` : /README_DATA\.md$/.test(u) ? `<a href="#data-readme">${t}</a>` : t);
// Repo paths in code spans link to the public repo (stakeholder-03 polish).
const REPO = 'https://github.com/tw-Zent/india-fire-calendar/blob/main/';
const codeSpan = (c) => {
  const m = c.match(/^(?:data\/processed\/|pipeline\/|reports\/)[\w./-]+$/);
  if (!m) return `<code>${c}</code>`;
  const p = c.startsWith('reports/') ? `data/processed/${c}` : c;
  return `<a href="${REPO}${p}" target="_blank" rel="noopener"><code>${c}</code></a>`;
};
export const slug = (t) => t.toLowerCase().replace(/&amp;|&/g, 'and').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const inline = (s) => esc(s).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => link(t, u)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(\S.*?)\*(?=\W|$)/g, '$1<em>$2</em>').replace(/`(.+?)`/g, (_, c) => codeSpan(c)).replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
export function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr />'); i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const n = Math.min(h[1].length + 1, 4); { const hh = inline(h[2]); out.push(`<h${n} id="m-${slug(hh)}">${hh}</h${n}>`); }; i++; continue; }
    if (l.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      out.push('<div class="tscroll"><table><thead><tr>' + body[0].map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.slice(1).map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>');
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*[-*]\s)/.test(lines[i])) { para.push(lines[i]); i++; }
    const ph = inline(para.join(' '));
    const lead = ph.match(/^<strong>([^<]+?)\.?<\/strong>/); // "**Title.** text" paragraphs get an anchor id
    out.push(lead ? `<p id="m-${slug(lead[1])}">${ph}</p>` : `<p>${ph}</p>`);
  }
  return out.join('\n');
}
