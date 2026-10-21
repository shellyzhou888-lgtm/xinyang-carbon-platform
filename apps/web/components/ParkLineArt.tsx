"use client";

import { motion, useReducedMotion } from "motion/react";
import planning from "@/data/planning-overlay.json";
import { enterprises } from "@/lib/park-geography";

type Point = [number, number];
const W = 1000, H = 760, PAD = 70;

// Project GCJ-02 lon/lat into the SVG box with an equirectangular fit (the park spans a few kilometres, so distortion is negligible).
const rings = planning.features.flatMap((feature) => feature.geometry.coordinates.map((polygon) => ({ feature, ring: polygon[0] as Point[] })));
const all = [...rings.flatMap(({ ring }) => ring), ...enterprises.map((feature) => feature.geometry.coordinates as Point)];
const [minX, maxX] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
const [minY, maxY] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
const scale = Math.min((W - PAD * 2) / ((maxX - minX) * kx), (H - PAD * 2) / (maxY - minY));
const offX = (W - (maxX - minX) * kx * scale) / 2, offY = (H - (maxY - minY) * scale) / 2;
// Rounded to 0.1 px so server and browser produce identical markup (no hydration drift from float maths).
const round = (v: number) => Math.round(v * 10) / 10;
const project = ([x, y]: Point): Point => [round(offX + (x - minX) * kx * scale), round(offY + (maxY - y) * scale)];
const path = (ring: Point[]) => ring.map((p, i) => `${i ? "L" : "M"}${project(p).join(" ")}`).join("") + "Z";

/**
 * Line drawing of the four planning zones and the public enterprise POIs, used as the login backdrop.
 * Geometry is the same approximate overlay as the map (schematic, not a legal boundary).
 */
export default function ParkLineArt() {
  const reduce = useReducedMotion();
  return (
    <svg className="park-line-art" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="信阳经开区四个规划功能片区与公开企业点位示意">
      <defs>
        <pattern id="dot-grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(197,240,92,.12)" /></pattern>
        <radialGradient id="art-glow" cx="50%" cy="50%" r="55%"><stop offset="0" stopColor="rgba(62,224,161,.16)" /><stop offset="1" stopColor="rgba(62,224,161,0)" /></radialGradient>
        <filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect width={W} height={H} fill="url(#dot-grid)" />
      <ellipse cx={W / 2} cy={H / 2} rx={W / 2} ry={H / 2} fill="url(#art-glow)" />
      {rings.map(({ feature, ring }, index) => (
        // Outline drawing uses a CSS keyframe on a normalised pathLength (renders identically on the server).
        <path key={index} className="art-zone" d={path(ring)} pathLength={1} fill={feature.properties.color} stroke={feature.properties.color} strokeWidth={1.6} strokeLinejoin="round" filter="url(#soft-glow)"
          style={{ animationDelay: `${0.2 + index * 0.12}s` }} />
      ))}
      {planning.features.map((feature, index) => {
        const [x, y] = project(feature.properties.labelPosition as Point);
        return <motion.g key={feature.properties.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6 + index * 0.15, duration: 0.6 }}>
          <text x={x} y={y} textAnchor="middle" className="art-label" fill={feature.properties.color}>{feature.properties.name}</text>
          <text x={x} y={y + 18} textAnchor="middle" className="art-sub">{feature.properties.areaKm2.toFixed(2)} km²</text>
        </motion.g>;
      })}
      {enterprises.map((feature, index) => {
        const [x, y] = project(feature.geometry.coordinates);
        return <g key={feature.properties.code}>
          {!reduce && <motion.circle cx={x} cy={y} r={4} fill="none" stroke="#c5f05c" strokeWidth={1}
            animate={{ r: [4, 16], opacity: [0.7, 0] }} transition={{ duration: 2.6, repeat: Infinity, delay: (index % 6) * 0.45, ease: "easeOut" }} />}
          <motion.circle cx={x} cy={y} r={3.2} fill="#c5f05c" initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.2 + index * 0.05, type: "spring", stiffness: 260, damping: 18 }} />
        </g>;
      })}
    </svg>
  );
}
