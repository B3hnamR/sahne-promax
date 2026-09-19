// Sahne ProMax — Reactive Application State
'use strict';

export const state = {
  cfg: null,
  runtimeState: null,
  info: null,
  selectedId: null
};

export function setConfig(c) {
  state.cfg = c;
}

export function setRuntimeState(s) {
  state.runtimeState = s;
}

export function setInfo(i) {
  state.info = i;
}

export function setSelectedId(id) {
  state.selectedId = id;
}
