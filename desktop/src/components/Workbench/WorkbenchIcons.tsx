import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

const BaseSvg: React.FC<IconProps> = ({ size = 15, children, style, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.65}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    {...rest}
  >
    {children}
  </svg>
);

export const SquareMenuIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <rect width="18" height="18" x="3" y="3" rx="3" />
    <path d="M7 8h10" />
    <path d="M7 12h10" />
    <path d="M7 16h6" />
  </BaseSvg>
);

export const TerminalSquareIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <rect width="18" height="18" x="3" y="3" rx="3" />
    <path d="m7 9 3 3-3 3" />
    <path d="M13 15h4" />
  </BaseSvg>
);

export const PanelRightIcon: React.FC<IconProps & { filled?: boolean }> = ({ filled, ...props }) => (
  <BaseSvg {...props}>
    <rect width="18" height="18" x="3" y="3" rx="3" />
    <path d="M15 3v18" />
    {filled && <rect x="15" y="3" width="6" height="18" rx="1" fill="currentColor" stroke="none" opacity={0.22} />}
  </BaseSvg>
);

export const PanelLeftIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <rect width="18" height="18" x="3" y="3" rx="3" />
    <path d="M9 3v18" />
  </BaseSvg>
);

export const Maximize2Icon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" x2="14" y1="3" y2="10" />
    <line x1="3" x2="10" y1="21" y2="14" />
  </BaseSvg>
);

export const Minimize2Icon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" x2="21" y1="10" y2="3" />
    <line x1="3" x2="10" y1="21" y2="14" />
  </BaseSvg>
);

export const MonitorIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <rect width="20" height="14" x="2" y="3" rx="2.5" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </BaseSvg>
);

export const FolderIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </BaseSvg>
);

export const FolderOpenIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </BaseSvg>
);

export const ExternalLinkIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </BaseSvg>
);

export const GitBranchIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <line x1="6" x2="6" y1="3" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </BaseSvg>
);

export const GitCommitIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <circle cx="12" cy="12" r="3" />
    <line x1="3" x2="9" y1="12" y2="12" />
    <line x1="15" x2="21" y1="12" y2="12" />
  </BaseSvg>
);

export const FileDiffIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M9 10h6" />
    <path d="M12 7v6" />
    <path d="M9 17h6" />
  </BaseSvg>
);

export const FileCodeIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="m10 13-2 2 2 2" />
    <path d="m14 17 2-2-2-2" />
  </BaseSvg>
);

export const PlugIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </BaseSvg>
);

export const PaperclipIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </BaseSvg>
);

export const ChevronDownIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="m6 9 6 6 6-6" />
  </BaseSvg>
);

export const ChevronRightIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="m9 18 6-6-6-6" />
  </BaseSvg>
);

export const MoreHorizontalIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </BaseSvg>
);

export const PlusIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </BaseSvg>
);

export const RefreshCwIcon: React.FC<IconProps & { spin?: boolean }> = ({ spin, style, ...props }) => (
  <BaseSvg
    style={{
      ...(spin ? { animation: 'qibox-spin 0.9s linear infinite' } : {}),
      ...style,
    }}
    {...props}
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </BaseSvg>
);

export const XIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </BaseSvg>
);

export const CheckIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="M20 6 9 17l-5-5" />
  </BaseSvg>
);

export const CopyIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </BaseSvg>
);

export const ChevronsUpDownIcon: React.FC<IconProps> = (props) => (
  <BaseSvg {...props}>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </BaseSvg>
);
