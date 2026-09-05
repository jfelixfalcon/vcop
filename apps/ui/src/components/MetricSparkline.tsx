import React from 'react';

interface Props {
  data: number[];
  color?: 'cyan' | 'emerald' | 'amber' | 'purple';
  height?: number;
  width?: number;
  label?: string;
  unit?: string;
  currentValue?: string | number;
}

export const MetricSparkline: React.FC<Props> = ({
  data,
  color = 'cyan',
  height = 36,
  width = 120,
  label,
  unit = '%',
  currentValue,
}) => {
  if (!data || data.length === 0) {
    data = [0, 0, 0, 0, 0];
  }

  const min = 0;
  const max = Math.max(...data, 100);
  const range = max - min || 1;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPoints = `${points} ${width},${height} 0,${height}`;

  const strokeColors = {
    cyan: '#00f2fe',
    emerald: '#10b981',
    amber: '#f59e0b',
    purple: '#a855f7',
  };

  const current = currentValue !== undefined ? currentValue : data[data.length - 1];

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 font-medium">{label}</span>
          <span className="font-mono text-slate-200 font-semibold">
            {current}{unit}
          </span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible w-full h-8"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`sparkline-grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColors[color]} stopOpacity="0.25" />
            <stop offset="100%" stopColor={strokeColors[color]} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <polygon
          points={areaPoints}
          fill={`url(#sparkline-grad-${color})`}
        />
        <polyline
          fill="none"
          stroke={strokeColors[color]}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    </div>
  );
};
