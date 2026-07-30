import type { MouseEvent, TouchEvent } from "react";
import {
  MouseSensor as LibMouseSensor,
  TouchSensor as LibTouchSensor,
  type MouseSensorOptions,
  type TouchSensorOptions,
} from "@dnd-kit/core";

/**
 * Sensores de dnd-kit que IGNORAN cualquier evento originado dentro de un
 * elemento marcado con `data-no-dnd` (o sus descendientes).
 *
 * Necesario porque los listeners de drag viven en el wrapper de la tarjeta:
 * sin esto, arrastrar el slider de progreso (o pulsar un botón interno)
 * arrastra también la tarjeta completa. `stopPropagation` por sí solo no
 * basta, porque dnd-kit registra los activadores en el nodo del draggable.
 */
function isNoDndTarget(el: EventTarget | null): boolean {
  let node = el as HTMLElement | null;
  while (node) {
    if (node.dataset && node.dataset.noDnd !== undefined) return true;
    node = node.parentElement;
  }
  return false;
}

export class MouseSensor extends LibMouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: (
        { nativeEvent: event }: MouseEvent,
        { onActivation }: MouseSensorOptions,
      ) => {
        // Botón derecho o zona protegida → no arrastrar
        if (event.button === 2 || isNoDndTarget(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

export class TouchSensor extends LibTouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: (
        { nativeEvent: event }: TouchEvent,
        { onActivation }: TouchSensorOptions,
      ) => {
        // Multi-touch (pinch/zoom) o zona protegida → no arrastrar
        if (event.touches.length > 1 || isNoDndTarget(event.target)) {
          return false;
        }
        onActivation?.({ event });
        return true;
      },
    },
  ];
}
