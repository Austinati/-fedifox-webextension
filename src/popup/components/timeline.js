/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import FedifoxMainBase from './mainbase.js';

customElements.define('fedifox-timeline', class FedifoxTimeline extends FedifoxMainBase {
  #lists = {};

  #currentList = "timeline";

  #navItems = [{
      listType: "timeline",
      name: "componentTimelineContentFeed"
    },
    {
      listType: "favourites",
      name: "componentTimelineFavourites"
    },
    {
      listType: "bookmarks",
      name: "componentTimelineBookmarks"
    }
  ]

  static observedAttributes = ['hidden'];

  connectedCallback() {
    super.connectedCallback();

    this.innerHTML = `
    <nav>
      ${this.#navItems.map(item => `<button data-list-type="${item.listType}">${chrome.i18n.getMessage(item.name)}</button>`).join('')}
    </nav>
    <h2></h2>
    <ol class="loading"></ol>
    `
  }

  handleEvent(e) {
    if (e.target.hasAttribute('data-list-type')) {
      this.sendMessage("fetchLists");
      this.#currentList = e.target.dataset.listType
      this.#renderList();
    }
  }

  #renderList() {
    const ol = this.querySelector("ol");
    ol.replaceChildren()
    ol.classList.remove('loading')

    this.querySelector('h2').textContent = chrome.i18n.getMessage(this.#navItems.find(item => item.listType === this.#currentList).name);

    const replyMap = new Map()

    this.#lists[this.#currentList]?.forEach(status => {
      const li = document.createElement('li')
      const card = document.createElement('status-card')
      card.setAttribute("id", status.id);
      card.setAttribute("action", true);
      card.initialize(status);
      li.append(card)
      ol.append(li)
      if (status.in_reply_to_id) {
        replyMap.has(status.in_reply_to_id) ? replyMap.get(status.in_reply_to_id).unshift(li) : replyMap.set(status.in_reply_to_id, [li])
      }
    })

    replyMap.forEach((value, key) => {
      const originalStatus = ol.querySelector(`status-card[id="${key}"]`)
      // if original status is present in timeline, thread replies
      // otherwise leave replies as-is: detatched in chronological order
      if (originalStatus) {
        const ol = document.createElement('ol')
        ol.append(...value) // value is an array of <li> replies 
        originalStatus.parentElement.append(ol)
      }
    })
  }

  setData(data) {
    if (data.timeline) {
      this.#lists.timeline = data.timeline;
    }

    if (data.favourites) {
      this.#lists.favourites = data.favourites;
    }

    if (data.bookmarks) {
      this.#lists.bookmarks = data.bookmarks;
    }

    if (this.#currentList in data) {
      this.#renderList();
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    // We are now visible!
    if (name === "hidden" && !this.hidden) {
      this.sendMessage("fetchLists");
    }
  }
});