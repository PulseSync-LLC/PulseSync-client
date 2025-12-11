import { useEffect, useRef } from "react";

interface Snowflake {
    x: number;
    y: number;
    r: number;
    speed: number;
    drift: number;
}

export default function Snowfall() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let w = (canvas.width = window.innerWidth);
        let h = (canvas.height = window.innerHeight);

        const flakes: Snowflake[] = [];

        const FLAKE_COUNT = 200;

        for (let i = 0; i < FLAKE_COUNT; i++) {
            flakes.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: Math.random() * 3 + 1,
                speed: Math.random() * 1 + 0.3,
                drift: (Math.random() - 0.5) * 0.5,
            });
        }

        const animate = () => {
            ctx.clearRect(0, 0, w, h);

            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.beginPath();

            for (let flake of flakes) {
                flake.y += flake.speed;
                flake.x += flake.drift;

                if (flake.y > h) {
                    flake.y = -10;
                    flake.x = Math.random() * w;
                }

                ctx.moveTo(flake.x, flake.y);
                ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
            }

            ctx.fill();
            requestAnimationFrame(animate);
        };

        animate();

        const resizeHandler = () => {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        };

        window.addEventListener("resize", resizeHandler);

        return () => {
            window.removeEventListener("resize", resizeHandler);
        };
    }, []);

    return <canvas ref={canvasRef} className="snowfall-canvas"></canvas>;
}
