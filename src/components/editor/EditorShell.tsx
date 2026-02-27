import { ImageEditor } from "@/components/ImageEditor";

type EditorShellProps = {
  imagePath: string;
  onSave: (editedImageData: string) => void;
  onCancel: () => void;
};

export function EditorShell({ imagePath, onSave, onCancel }: EditorShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <ImageEditor imagePath={imagePath} onSave={onSave} onCancel={onCancel} />
    </main>
  );
}
