const { marked } = require('marked');

// breaks:true so a single Enter in the plain <textarea> quick-post box
// becomes a line break — without it, markdown's normal "blank line for a
// new paragraph" rule would surprise anyone just typing fast updates.
// Trusted same as TinyMCE article bodies elsewhere in this app (admin-only
// input, already injected unescaped) — no HTML sanitization here either.
marked.setOptions({ breaks: true });

function renderEntryContent(content) {
  return marked.parse(content || '');
}

module.exports = { renderEntryContent };
