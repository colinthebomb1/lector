import { CodeSnippet } from './CodeSnippet';

interface FeatureProps {
  title: string;
  description: string;
  code: string;
}

export function Feature({ title, description, code }: FeatureProps) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl">{title}</h3>
      <p className="text-muted-foreground text-sm tracking-wide">{description}</p>
      <CodeSnippet code={code} />
    </div>
  );
}
