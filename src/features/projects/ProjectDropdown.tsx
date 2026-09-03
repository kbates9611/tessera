import { FolderKanban, Plus } from "lucide-react";
import type { TesseraProject } from "../../domain/types";
import { TopbarPicker } from "../../app/TopbarPicker";

export function ProjectDropdown({
  projects,
  activeId,
  onSelect,
  onNew,
}: {
  projects: TesseraProject[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <TopbarPicker
      ariaLabel="Dashboard group"
      listLabel="Dashboard groups"
      value={activeId}
      options={projects.map((project) => ({
        value: project.id,
        label: project.name,
      }))}
      onSelect={onSelect}
      icon={<FolderKanban size={15} aria-hidden="true" />}
      variant="project-picker"
      triggerId="project-picker"
      action={{
        label: "New dashboard group",
        icon: <Plus size={14} aria-hidden="true" />,
        onClick: onNew,
      }}
    />
  );
}
