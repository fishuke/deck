import { AppearanceSettings, PluginsSettings } from "../extensions/AppearanceSettings.js";
import { GeneralSettings } from "./GeneralSettings.js";
import { KeybindsSettings } from "./KeybindsSettings.js";
import { WorkspaceSettings } from "./WorkspaceSettings.js";

export const settingsSections = [
  { id: "appearance", label: "Appearance" },
  { id: "plugins", label: "Plugins" },
  { id: "keybinds", label: "Keybinds" },
  { id: "workspaces", label: "Workspaces" },
  { id: "general", label: "General" },
] as const;
export type SettingsSection = (typeof settingsSections)[number]["id"];

export function SettingsView({ section, onSection }: { section: SettingsSection; onSection: (section: SettingsSection) => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-baseline gap-3 border-b border-edge px-6 py-3.5">
        <span className="font-bold text-ink">Settings</span>
        <div className="ml-4 flex gap-1 font-sans text-xs">{settingsSections.map((tab) => <button key={tab.id} onClick={() => onSection(tab.id)} className={`rounded-md px-3 py-1.5 ${section === tab.id ? "bg-card2 text-soft" : "text-mut hover:text-soft"}`}>{tab.label}</button>)}</div>
      </div>
      {section === "appearance" && <AppearanceSettings />}
      {section === "plugins" && <PluginsSettings />}
      {section === "keybinds" && <KeybindsSettings />}
      {section === "workspaces" && <WorkspaceSettings />}
      {section === "general" && <GeneralSettings />}
    </div>
  );
}
