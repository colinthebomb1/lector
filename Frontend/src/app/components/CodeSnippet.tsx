interface CodeSnippetProps {
  code: string;
}

export function CodeSnippet({ code }: CodeSnippetProps) {
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const highlightCode = (code: string) => {
    const lines = code.split('\n');
    return lines.map((line, i) => {
      const tokens: string[] = [];
      let highlighted = escapeHtml(line);

      highlighted = highlighted.replace(
        /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g,
        (match) => {
          const token = `__TOKEN_${tokens.length}__`;
          tokens.push(`<span class="text-[#50FA7B]">${match}</span>`);
          return token;
        },
      );

      highlighted = highlighted.replace(/#.*$/g, (match) => {
        const token = `__TOKEN_${tokens.length}__`;
        tokens.push(`<span class="text-[#6272A4]">${match}</span>`);
        return token;
      });

      highlighted = highlighted.replace(
        /\b(def|return|if|elif|else|async|await|raise|class|for|in|try|except|with|import|from)\b/g,
        '<span class="text-[#FF79C6]">$1</span>',
      );

      highlighted = highlighted.replace(/__TOKEN_(\d+)__/g, (_, index) => tokens[Number(index)] ?? '');

      return (
        <div
          key={i}
          className="whitespace-pre-wrap break-words pl-6 -indent-6"
          dangerouslySetInnerHTML={{ __html: highlighted || '\u200b' }}
        />
      );
    });
  };

  return (
    <pre className="bg-card p-4 rounded border border-border hover:border-accent/30 transition-colors overflow-hidden">
      <code className="text-sm text-foreground/80 block leading-relaxed font-mono">
        {highlightCode(code)}
      </code>
    </pre>
  );
}
