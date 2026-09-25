export interface ToggleDef {
  key: string;
  label: string;
  title: string;
  checked: () => boolean;
  change: () => void;
  labelClass?: string;
}
