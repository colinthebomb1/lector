interface CodeSnippetProps {
  code: string;
}

export function CodeSnippet({ code }: CodeSnippetProps) {
  const highlightCode = (code: string) => {
    const lines = code.split('\n');
    return lines.map((line, i) => {
      let highlighted = line;

      highlighted = highlighted.replace(/(function|const|return|if|async|await|throw|new)/g, '<span class="text-[#FF79C6]">$1</span>');

      highlighted = highlighted.replace(/\/\/(.*)/g, '<span class="text-[#6272A4]">//$1</span>');

      highlighted = highlighted.replace(/(['"`].*?['"`])/g, '<span class="text-[#50FA7B]">$1</span>');

      return (
        <div key={i} dangerouslySetInnerHTML={{ __html: highlighted }} />
      );
    });
  };

  return (
    <pre className="bg-card p-4 rounded border border-border overflow-x-auto hover:border-accent/30 transition-colors">
      <code className="text-sm text-foreground/80 block leading-relaxed">
        {highlightCode(code)}
      </code>
    </pre>
  );
}
