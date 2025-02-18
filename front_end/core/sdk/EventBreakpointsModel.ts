// Copyright 2021 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type * as Common from '../common/common.js';
import * as i18n from '../i18n/i18n.js';
import type * as ProtocolProxyApi from '../../generated/protocol-proxy-api.js';

import {CategorizedBreakpoint} from './CategorizedBreakpoint.js';
import type {Target} from './Target.js';
import {Capability} from './Target.js';
import {SDKModel} from './SDKModel.js';
import type {SDKModelObserver} from './TargetManager.js';
import {TargetManager} from './TargetManager.js';

const UIStrings = {
  /**
   * @description Category of breakpoints
   */
  auctionWorklet: 'Ad Auction Worklet',

  /**
   * @description Name of a breakpoint type.
   * https://github.com/WICG/turtledove/blob/main/FLEDGE.md#32-on-device-bidding
   */
  beforeBidderWorkletBiddingStart: 'Bidder Bidding Phase Start',

  /**
   * @description Name of a breakpoint type.
   * https://github.com/WICG/turtledove/blob/main/FLEDGE.md#52-buyer-reporting-on-render-and-ad-events
   */
  beforeBidderWorkletReportingStart: 'Bidder Reporting Phase Start',

  /**
   * @description Name of a breakpoint type.
   * https://github.com/WICG/turtledove/blob/main/FLEDGE.md#23-scoring-bids
   */
  beforeSellerWorkletScoringStart: 'Seller Scoring Phase Start',

  /**
   * @description Name of a breakpoint type.
   * https://github.com/WICG/turtledove/blob/main/FLEDGE.md#51-seller-reporting-on-render
   */
  beforeSellerWorkletReportingStart: 'Seller Reporting Phase Start',
};

const str_ = i18n.i18n.registerUIStrings('core/sdk/EventBreakpointsModel.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

const enum InstrumentationNames {
  BeforeBidderWorkletBiddingStart = 'beforeBidderWorkletBiddingStart',
  BeforeBidderWorkletReportingStart = 'beforeBidderWorkletReportingStart',
  BeforeSellerWorkletScoringStart = 'beforeSellerWorkletScoringStart',
  BeforeSellerWorkletReportingStart = 'beforeSellerWorkletReportingStart',
}

function getTitleForInstrumentationName(instrumentationName: InstrumentationNames): Common.UIString.LocalizedString {
  switch (instrumentationName) {
    case InstrumentationNames.BeforeBidderWorkletBiddingStart:
      return i18nString(UIStrings.beforeBidderWorkletBiddingStart);

    case InstrumentationNames.BeforeBidderWorkletReportingStart:
      return i18nString(UIStrings.beforeBidderWorkletReportingStart);

    case InstrumentationNames.BeforeSellerWorkletScoringStart:
      return i18nString(UIStrings.beforeSellerWorkletScoringStart);

    case InstrumentationNames.BeforeSellerWorkletReportingStart:
      return i18nString(UIStrings.beforeSellerWorkletReportingStart);
  }
}

export class EventBreakpointsModel extends SDKModel<void> {
  readonly agent: ProtocolProxyApi.EventBreakpointsApi;

  constructor(target: Target) {
    super(target);
    this.agent = target.eventBreakpointsAgent();
  }
}

// This implementation (as opposed to similar class in DOMDebuggerModel) is for
// instrumentation breakpoints in targets that run JS but do not have a DOM.
class EventListenerBreakpoint extends CategorizedBreakpoint {
  readonly instrumentationName: string;
  constructor(instrumentationName: InstrumentationNames, category: string) {
    super(category, getTitleForInstrumentationName(instrumentationName));
    this.instrumentationName = instrumentationName;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled() === enabled) {
      return;
    }
    super.setEnabled(enabled);
    for (const model of TargetManager.instance().models(EventBreakpointsModel)) {
      this.updateOnModel(model);
    }
  }

  updateOnModel(model: EventBreakpointsModel): void {
    if (this.enabled()) {
      model.agent.invoke_setInstrumentationBreakpoint({eventName: this.instrumentationName});
    } else {
      model.agent.invoke_removeInstrumentationBreakpoint({eventName: this.instrumentationName});
    }
  }

  static readonly instrumentationPrefix = 'instrumentation:';
}

let eventBreakpointManagerInstance: EventBreakpointsManager;

export class EventBreakpointsManager implements SDKModelObserver<EventBreakpointsModel> {
  readonly #eventListenerBreakpointsInternal: EventListenerBreakpoint[] = [];

  constructor() {
    this.createInstrumentationBreakpoints(i18nString(UIStrings.auctionWorklet), [
      InstrumentationNames.BeforeBidderWorkletBiddingStart,
      InstrumentationNames.BeforeBidderWorkletReportingStart,
      InstrumentationNames.BeforeSellerWorkletScoringStart,
      InstrumentationNames.BeforeSellerWorkletReportingStart,
    ]);

    TargetManager.instance().observeModels(EventBreakpointsModel, this);
  }

  static instance(opts: {
    forceNew: boolean|null,
  } = {forceNew: null}): EventBreakpointsManager {
    const {forceNew} = opts;
    if (!eventBreakpointManagerInstance || forceNew) {
      eventBreakpointManagerInstance = new EventBreakpointsManager();
    }

    return eventBreakpointManagerInstance;
  }

  private createInstrumentationBreakpoints(category: string, instrumentationNames: InstrumentationNames[]): void {
    for (const instrumentationName of instrumentationNames) {
      this.#eventListenerBreakpointsInternal.push(new EventListenerBreakpoint(instrumentationName, category));
    }
  }

  eventListenerBreakpoints(): EventListenerBreakpoint[] {
    return this.#eventListenerBreakpointsInternal.slice();
  }

  resolveEventListenerBreakpointTitle(auxData: {
    eventName: string,
  }): string|null {
    const breakpoint = this.resolveEventListenerBreakpoint(auxData);
    return breakpoint ? breakpoint.title() : null;
  }

  resolveEventListenerBreakpoint(auxData: {eventName: string}): EventListenerBreakpoint|null {
    const eventName = auxData.eventName;
    if (!eventName.startsWith(EventListenerBreakpoint.instrumentationPrefix)) {
      return null;
    }

    const instrumentationName = eventName.substring(EventListenerBreakpoint.instrumentationPrefix.length);
    return this.#eventListenerBreakpointsInternal.find(b => b.instrumentationName === instrumentationName) || null;
  }

  modelAdded(eventBreakpointModel: EventBreakpointsModel): void {
    for (const breakpoint of this.#eventListenerBreakpointsInternal) {
      if (breakpoint.enabled()) {
        breakpoint.updateOnModel(eventBreakpointModel);
      }
    }
  }

  modelRemoved(_eventBreakpointModel: EventBreakpointsModel): void {
  }
}

SDKModel.register(EventBreakpointsModel, {capabilities: Capability.EventBreakpoints, autostart: false});
