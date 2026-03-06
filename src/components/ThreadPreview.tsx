import React, { useMemo } from 'react';
import { Canvas, Line, vec, Rect, Circle } from '@shopify/react-native-skia';
import { NailPosition } from '../algorithm/stringArt';
import { FrameShape } from '../store/projectStore';

interface ThreadPreviewProps {
  shape: FrameShape;
  nailPositions: NailPosition[];
  nailSequence: number[] | null;
  colorLayers?: { color: string; nailSequence: number[] }[] | null;
  size: number;
}

export function ThreadPreview({
  shape,
  nailPositions,
  nailSequence,
  colorLayers,
  size,
}: ThreadPreviewProps) {
  const padding = 10;
  const drawSize = size - padding * 2;

  const nailCoords = useMemo(
    () =>
      nailPositions.map((n) => ({
        x: padding + n.x * drawSize,
        y: padding + n.y * drawSize,
      })),
    [nailPositions, drawSize, padding],
  );

  // Downsample strings for preview rendering (max 2000 lines for performance)
  function sampleSequence(seq: number[], maxLines: number): [number, number][] {
    const pairs: [number, number][] = [];
    for (let i = 0; i < seq.length - 1; i++) {
      pairs.push([seq[i], seq[i + 1]]);
    }
    if (pairs.length <= maxLines) return pairs;
    const step = Math.ceil(pairs.length / maxLines);
    return pairs.filter((_, i) => i % step === 0);
  }

  const bwLines = useMemo(() => {
    if (!nailSequence) return [];
    return sampleSequence(nailSequence, 2000);
  }, [nailSequence]);

  const colorLines = useMemo(() => {
    if (!colorLayers) return [];
    return colorLayers.map((layer) => ({
      color: layer.color,
      pairs: sampleSequence(layer.nailSequence, 800),
    }));
  }, [colorLayers]);

  return (
    <Canvas style={{ width: size, height: size }}>
      {/* Background */}
      <Rect x={0} y={0} width={size} height={size} color="#fafafa" />

      {/* Frame outline */}
      {shape === 'circle' ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={drawSize / 2}
          color="transparent"
          style="stroke"
          strokeWidth={1}
        />
      ) : (
        <Rect
          x={padding}
          y={padding}
          width={drawSize}
          height={drawSize}
          color="transparent"
          style="stroke"
          strokeWidth={1}
        />
      )}

      {/* B&W strings */}
      {bwLines.map(([from, to], i) => {
        const a = nailCoords[from];
        const b = nailCoords[to];
        if (!a || !b) return null;
        return (
          <Line
            key={i}
            p1={vec(a.x, a.y)}
            p2={vec(b.x, b.y)}
            color="rgba(0,0,0,0.12)"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Color strings */}
      {colorLines.map((layer, li) =>
        layer.pairs.map(([from, to], i) => {
          const a = nailCoords[from];
          const b = nailCoords[to];
          if (!a || !b) return null;
          // Parse hex to rgba with low opacity for layering effect
          const hex = layer.color.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b2 = parseInt(hex.substring(4, 6), 16);
          return (
            <Line
              key={`${li}-${i}`}
              p1={vec(a.x, a.y)}
              p2={vec(b.x, b.y)}
              color={`rgba(${r},${g},${b2},0.15)`}
              strokeWidth={0.5}
            />
          );
        }),
      )}

      {/* Nails */}
      {nailCoords.map((coord, i) => (
        <Circle key={i} cx={coord.x} cy={coord.y} r={3} color="#333" />
      ))}
    </Canvas>
  );
}
