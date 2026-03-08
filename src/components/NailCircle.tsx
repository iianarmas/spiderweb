import React, { useMemo } from 'react';
import { Canvas, Circle, Line, vec, Rect, Text as SkiaText, useFont, Group, Paint, Path, Skia } from '@shopify/react-native-skia';
import { NailPosition } from '../algorithm/stringArt';
import { FrameShape } from '../store/projectStore';

interface NailCircleProps {
  shape: FrameShape;
  nailPositions: NailPosition[];
  completedPairs: [number, number][];
  currentFrom: number;
  currentTo: number;
  size: number;
}

const NAIL_RADIUS = 5;
const STRING_OPACITY = 0.35;
const ACTIVE_STRING_OPACITY = 0.9;

export function NailCircle({
  shape,
  nailPositions,
  completedPairs,
  currentFrom,
  currentTo,
  size,
}: NailCircleProps) {
  const padding = 20;
  const drawSize = size - padding * 2;

  // Convert normalized nail positions to canvas coordinates
  const nailCoords = useMemo(
    () =>
      nailPositions.map((n) => ({
        x: padding + n.x * drawSize,
        y: padding + n.y * drawSize,
      })),
    [nailPositions, drawSize, padding],
  );

  const completedPath = useMemo(() => {
    const p = Skia.Path.Make();
    completedPairs.forEach(([from, to]) => {
      const a = nailCoords[from];
      const b = nailCoords[to];
      if (a && b) {
        p.moveTo(a.x, a.y);
        p.lineTo(b.x, b.y);
      }
    });
    return p;
  }, [completedPairs, nailCoords]);

  const hasCurrentLine = currentFrom >= 0 && currentTo >= 0 &&
    currentFrom < nailCoords.length && currentTo < nailCoords.length;

  return (
    <Canvas style={{ width: size, height: size }}>
      {/* Background */}
      <Rect x={0} y={0} width={size} height={size} color="#0d0d1a" />

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

      {/* Completed strings (grey, thin) */}
      <Path
        path={completedPath}
        color={`rgba(160, 140, 200, ${STRING_OPACITY})`}
        style="stroke"
        strokeWidth={0.5}
      />

      {/* Current active string (bright) */}
      {hasCurrentLine && (
        <Line
          p1={vec(nailCoords[currentFrom].x, nailCoords[currentFrom].y)}
          p2={vec(nailCoords[currentTo].x, nailCoords[currentTo].y)}
          color={`rgba(255, 140, 0, ${ACTIVE_STRING_OPACITY})`}
          strokeWidth={2}
        />
      )}

      {/* Nails */}
      {nailCoords.map((coord, i) => {
        const isFrom = i === currentFrom;
        const isTo = i === currentTo;
        const color = isFrom
          ? '#2ecc71'
          : isTo
            ? '#ff8c00'
            : '#4a4a6a';
        const r = isFrom || isTo ? NAIL_RADIUS + 2 : NAIL_RADIUS;
        return (
          <Circle key={`n-${i}`} cx={coord.x} cy={coord.y} r={r} color={color} />
        );
      })}

      {/* Nail number labels for current nails */}
      {hasCurrentLine && nailCoords.length > 0 && (
        <>
          <SkiaText
            x={nailCoords[currentFrom].x - 12}
            y={nailCoords[currentFrom].y - 12}
            text={String(currentFrom + 1)}
            color="#2ecc71"
            font={null}
          />
          <SkiaText
            x={nailCoords[currentTo].x - 12}
            y={nailCoords[currentTo].y - 12}
            text={String(currentTo + 1)}
            color="#ff8c00"
            font={null}
          />
        </>
      )}
    </Canvas>
  );
}
