// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../../core/common/common.js';
import * as WindowBoundsService from '../../../services/window_bounds/window_bounds.js';
import * as CodeMirror from '../../../third_party/codemirror.next/codemirror.next.js';
import * as LitHtml from '../../lit-html/lit-html.js';
import * as CodeHighlighter from '../code_highlighter/code_highlighter.js';
import * as ComponentHelpers from '../helpers/helpers.js';

import {baseConfiguration, dynamicSetting, DynamicSetting} from './config.js';
import {toLineColumn, toOffset} from './position.js';

declare global {
  interface HTMLElementTagNameMap {
    'devtools-text-editor': TextEditor;
  }
}

export class TextEditor extends HTMLElement {
  static readonly litTagName = LitHtml.literal`devtools-text-editor`;

  private readonly shadow = this.attachShadow({mode: 'open'});
  private activeEditor: CodeMirror.EditorView|undefined = undefined;
  private dynamicSettings: readonly DynamicSetting<unknown>[] = DynamicSetting.none;
  private activeSettingListeners: [Common.Settings.Setting<unknown>, (event: {data: unknown}) => void][] = [];
  private pendingState: CodeMirror.EditorState|undefined;
  private lastScrollPos = {left: 0, top: 0};
  private resizeTimeout = -1;
  private devtoolsResizeObserver = new ResizeObserver(() => {
    if (this.resizeTimeout < 0) {
      this.resizeTimeout = window.setTimeout(() => {
        this.resizeTimeout = -1;
        if (this.activeEditor) {
          CodeMirror.repositionTooltips(this.activeEditor);
        }
      }, 50);
    }
  });

  constructor(pendingState?: CodeMirror.EditorState) {
    super();
    this.pendingState = pendingState;
    this.shadow.adoptedStyleSheets = [CodeHighlighter.Style.default];
  }

  private createEditor(): CodeMirror.EditorView {
    this.activeEditor = new CodeMirror.EditorView({
      state: this.state,
      parent: this.shadow,
      root: this.shadow,
      dispatch: (tr: CodeMirror.Transaction): void => {
        this.editor.update([tr]);
        if (tr.reconfigured) {
          this.ensureSettingListeners();
        }
      },
    });
    this.activeEditor.scrollDOM.scrollTop = this.lastScrollPos.top;
    this.activeEditor.scrollDOM.scrollLeft = this.lastScrollPos.left;
    this.activeEditor.scrollDOM.addEventListener('scroll', (event): void => {
      this.lastScrollPos.left = (event.target as HTMLElement).scrollLeft;
      this.lastScrollPos.top = (event.target as HTMLElement).scrollTop;
    });
    this.ensureSettingListeners();
    this.startObservingResize();
    return this.activeEditor;
  }

  get editor(): CodeMirror.EditorView {
    return this.activeEditor || this.createEditor();
  }

  dispatch(spec: CodeMirror.TransactionSpec): void {
    return this.editor.dispatch(spec);
  }

  get state(): CodeMirror.EditorState {
    if (this.activeEditor) {
      return this.activeEditor.state;
    }
    if (!this.pendingState) {
      this.pendingState = CodeMirror.EditorState.create({extensions: baseConfiguration('')});
    }
    return this.pendingState;
  }

  set state(state: CodeMirror.EditorState) {
    if (this.activeEditor) {
      this.activeEditor.setState(state);
    } else {
      this.pendingState = state;
    }
  }

  connectedCallback(): void {
    if (!this.activeEditor) {
      this.createEditor();
    }
  }

  disconnectedCallback(): void {
    if (this.activeEditor) {
      this.pendingState = this.activeEditor.state;
      this.devtoolsResizeObserver.disconnect();
      this.activeEditor.destroy();
      this.activeEditor = undefined;
      this.ensureSettingListeners();
    }
  }

  focus(): void {
    if (this.activeEditor) {
      this.activeEditor.focus();
    }
  }

  private ensureSettingListeners(): void {
    const dynamicSettings = this.activeEditor ? this.activeEditor.state.facet(dynamicSetting) : DynamicSetting.none;
    if (dynamicSettings === this.dynamicSettings) {
      return;
    }
    this.dynamicSettings = dynamicSettings;

    for (const [setting, listener] of this.activeSettingListeners) {
      setting.removeChangeListener(listener);
    }
    this.activeSettingListeners = [];

    const settings = Common.Settings.Settings.instance();
    for (const dynamicSetting of dynamicSettings) {
      const handler = ({data}: {data: unknown}): void => {
        const change = dynamicSetting.sync(this.state, data);
        if (change && this.activeEditor) {
          this.activeEditor.dispatch({effects: change});
        }
      };
      const setting = settings.moduleSetting(dynamicSetting.settingName);
      setting.addChangeListener(handler);
      this.activeSettingListeners.push([setting, handler]);
    }
  }

  private startObservingResize(): void {
    const devtoolsElement =
        WindowBoundsService.WindowBoundsService.WindowBoundsServiceImpl.instance().getDevToolsBoundingElement();
    if (devtoolsElement) {
      this.devtoolsResizeObserver.observe(devtoolsElement);
    }
  }

  revealPosition(selection: CodeMirror.EditorSelection, highlight: boolean = true): void {
    const view = this.activeEditor;
    if (!view) {
      return;
    }

    const line = view.state.doc.lineAt(selection.main.head);
    const effects: CodeMirror.StateEffect<unknown>[] = [];
    if (highlight) {
      effects.push(
          view.state.field(highlightState, false) ?
              setHighlightLine.of(line.from) :
              CodeMirror.StateEffect.appendConfig.of(highlightState.init(() => highlightDeco(line.from))));
    }
    const editorRect = view.scrollDOM.getBoundingClientRect();
    const targetPos = view.coordsAtPos(selection.main.head);
    if (!targetPos || targetPos.top < editorRect.top || targetPos.bottom > editorRect.bottom) {
      effects.push(CodeMirror.EditorView.centerOn.of(selection.main));
    }

    view.dispatch({
      selection,
      effects,
      userEvent: 'select.reveal',
    });
    if (highlight) {
      const {id} = view.state.field(highlightState);
      // Reset the highlight state if, after 2 seconds (the animation
      // duration) it is still showing this highlight.
      setTimeout(() => {
        if (view.state.field(highlightState).id === id) {
          view.dispatch({effects: setHighlightLine.of(null)});
        }
      }, 2000);
    }
  }

  createSelection(head: {lineNumber: number, columnNumber: number}, anchor?: {
    lineNumber: number,
    columnNumber: number,
  }): CodeMirror.EditorSelection {
    const {doc} = this.state;
    const headPos = toOffset(doc, head);
    return CodeMirror.EditorSelection.single(anchor ? toOffset(doc, anchor) : headPos, headPos);
  }

  toLineColumn(pos: number): {lineNumber: number, columnNumber: number} {
    return toLineColumn(this.state.doc, pos);
  }

  toOffset(pos: {lineNumber: number, columnNumber: number}): number {
    return toOffset(this.state.doc, pos);
  }
}

ComponentHelpers.CustomElements.defineComponent('devtools-text-editor', TextEditor);

const setHighlightLine = CodeMirror.StateEffect.define<number|null>(
    {map: (value, mapping) => value === null ? null : mapping.mapPos(value)});

function highlightDeco(position: number): {deco: CodeMirror.DecorationSet, id: number} {
  const deco = CodeMirror.Decoration.set(
      [CodeMirror.Decoration.line({attributes: {class: 'cm-highlightedLine'}}).range(position)]);
  return {deco, id: Math.floor(Math.random() * 0xfffff)};
}

const highlightState = CodeMirror.StateField.define<{deco: CodeMirror.DecorationSet, id: number}>({
  create: () => ({deco: CodeMirror.Decoration.none, id: 0}),
  update(value, tr) {
    if (!tr.changes.empty && value.deco.size) {
      value = {deco: value.deco.map(tr.changes), id: value.id};
    }
    for (const effect of tr.effects) {
      if (effect.is(setHighlightLine)) {
        value = effect.value === null ? {deco: CodeMirror.Decoration.none, id: 0} : highlightDeco(effect.value);
      }
    }
    return value;
  },
  provide: field => CodeMirror.EditorView.decorations.from(field, value => value.deco),
});
