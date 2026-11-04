import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const BASE = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function PlayIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M8.4 5.4 18.6 12 8.4 18.6V5.4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="7.5" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.3" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function CollapseIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />
    </svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

export function StatsIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M4.5 19.5h15" />
      <rect x="6" y="12" width="3" height="7.5" rx="1" fill="currentColor" stroke="none" opacity=".75" />
      <rect x="10.5" y="8" width="3" height="11.5" rx="1" fill="currentColor" stroke="none" opacity=".9" />
      <rect x="15" y="4.5" width="3" height="15" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M4.8 12a7.2 7.2 0 1 0 2.3-5.3" />
      <path d="M4.5 4.8v4.4h4.4" />
    </svg>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="6.2" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M12 2.6v3.1M12 18.3v3.1M2.6 12h3.1M18.3 12h3.1" />
    </svg>
  );
}

export function TrainIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="6" y="3.8" width="12" height="13" rx="3" />
      <path d="M9 8.2h6" />
      <path d="m7.6 16.8-2 3.4M16.4 16.8l2 3.4M6.5 20.2h11" />
      <circle cx="9.2" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect x="4" y="4" width="6.2" height="6.2" rx="1.4" />
      <rect x="13.8" y="4" width="6.2" height="6.2" rx="1.4" />
      <rect x="4" y="13.8" width="6.2" height="6.2" rx="1.4" />
      <rect x="13.8" y="13.8" width="6.2" height="6.2" rx="1.4" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6V12l3 1.9" />
    </svg>
  );
}
