import { LoaderCircle, type LucideProps } from "lucide-react";

/**
 * Icono de "En curso": un LoaderCircle que gira lentamente para dar
 * sensación de trabajo activo en progreso.
 *
 * Respeta `prefers-reduced-motion` (Tailwind's `motion-safe:animate-spin`
 * solo anima si el usuario no pidió reducir el movimiento).
 * Drop-in compatible con `LucideIcon` (mismas props: className, style, etc.).
 */
export function EnCursoIcon(props: LucideProps) {
  return (
    <LoaderCircle
      {...props}
      className={`${props.className ?? ""} motion-safe:animate-spin [animation-duration:2.5s]`}
    />
  );
}
