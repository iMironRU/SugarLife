import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, CustomChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, CustomChart, GridComponent, MarkLineComponent, MarkAreaComponent, TooltipComponent, CanvasRenderer]);

export function cssVar(name: string, fallback = '#888') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function EChart({ option, height = 200 }: { option: any; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, null, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); inst.current?.dispose(); inst.current = null; };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option, true);
    inst.current?.resize();
  }, [option]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
