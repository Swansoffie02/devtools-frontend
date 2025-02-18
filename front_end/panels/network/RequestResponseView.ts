/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import * as Common from '../../core/common/common.js';
import * as i18n from '../../core/i18n/i18n.js';
import type * as SDK from '../../core/sdk/sdk.js';
import * as SourceFrame from '../../ui/legacy/components/source_frame/source_frame.js';
import * as UI from '../../ui/legacy/legacy.js';

const UIStrings = {
  /**
  *@description Text in Request Response View of the Network panel
  */
  thisRequestHasNoResponseData: 'This request has no response data available.',
  /**
  *@description Text in Request Preview View of the Network panel
  */
  failedToLoadResponseData: 'Failed to load response data',
};
const str_ = i18n.i18n.registerUIStrings('panels/network/RequestResponseView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);
export class RequestResponseView extends UI.Widget.VBox {
  request: SDK.NetworkRequest.NetworkRequest;
  private contentViewPromise: Promise<UI.Widget.Widget>|null;

  constructor(request: SDK.NetworkRequest.NetworkRequest) {
    super();
    this.element.classList.add('request-view');
    this.request = request;
    this.contentViewPromise = null;
  }

  private static hasTextContent(
      request: SDK.NetworkRequest.NetworkRequest, contentData: SDK.NetworkRequest.ContentData): boolean {
    const mimeType = request.mimeType || '';
    let resourceType = Common.ResourceType.ResourceType.fromMimeType(mimeType);
    if (resourceType === Common.ResourceType.resourceTypes.Other) {
      resourceType = request.contentType();
    }
    if (resourceType === Common.ResourceType.resourceTypes.Image) {
      return mimeType.startsWith('image/svg');
    }
    if (resourceType.isTextType()) {
      return true;
    }
    if (contentData.error) {
      return false;
    }
    if (resourceType === Common.ResourceType.resourceTypes.Other) {
      return Boolean(contentData.content) && !contentData.encoded;
    }
    return false;
  }

  static async sourceViewForRequest(request: SDK.NetworkRequest.NetworkRequest): Promise<UI.Widget.Widget|null> {
    let sourceView = requestToSourceView.get(request);
    if (sourceView !== undefined) {
      return sourceView;
    }

    const contentData = await request.contentData();
    if (!RequestResponseView.hasTextContent(request, contentData)) {
      requestToSourceView.delete(request);
      return null;
    }

    const highlighterType = request.resourceType().canonicalMimeType() || request.mimeType;
    sourceView = SourceFrame.ResourceSourceFrame.ResourceSourceFrame.createSearchableView(request, highlighterType);
    requestToSourceView.set(request, sourceView);
    return sourceView;
  }

  wasShown(): void {
    this.doShowPreview();
  }

  private doShowPreview(): Promise<UI.Widget.Widget> {
    if (!this.contentViewPromise) {
      this.contentViewPromise = this.showPreview();
    }
    return this.contentViewPromise;
  }

  async showPreview(): Promise<UI.Widget.Widget> {
    const responseView = await this.createPreview();
    responseView.show(this.element);
    return responseView;
  }

  async createPreview(): Promise<UI.Widget.Widget> {
    const contentData = await this.request.contentData();
    const sourceView = await RequestResponseView.sourceViewForRequest(this.request);
    if ((!contentData.content || !sourceView) && !contentData.error) {
      return new UI.EmptyWidget.EmptyWidget(i18nString(UIStrings.thisRequestHasNoResponseData));
    }
    if (contentData.content && sourceView) {
      return sourceView;
    }
    if (contentData.error) {
      return new UI.EmptyWidget.EmptyWidget(i18nString(UIStrings.failedToLoadResponseData) + ': ' + contentData.error);
    }
    if (this.request.statusCode === 204) {
      return new UI.EmptyWidget.EmptyWidget(i18nString(UIStrings.thisRequestHasNoResponseData));
    }
    return new UI.EmptyWidget.EmptyWidget(i18nString(UIStrings.failedToLoadResponseData));
  }

  async revealLine(line: number): Promise<void> {
    const view = await this.doShowPreview();
    if (view instanceof SourceFrame.ResourceSourceFrame.SearchableContainer) {
      view.revealPosition(line);
    }
  }
}

const requestToSourceView = new WeakMap<SDK.NetworkRequest.NetworkRequest, UI.Widget.Widget>();
