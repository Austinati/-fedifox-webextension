import {
  Component
} from "./component.js";
import {
  Logger
} from "./logger.js";
import StorageUtils from "./storageUtils.js";

const log = Logger.logger("UI");

export class UI extends Component {
  #currentPort;
  #currentWindowId;
  #messageQueue = [];
  #tabs = {};

  constructor(receiver) {
    super(receiver);

    browser.runtime.onConnect.addListener(async port => {
      if (port.name === "panel") {
        await this.#panelConnected(port);
      }
    });

    // To know the current tab to share, we need to track the focused window.
    browser.windows.onFocusChanged.addListener(windowId => this.#currentWindowId = windowId);

    browser.tabs.onRemoved.addListener(tabId => this.#deleteTabData(tabId));
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading') {
        this.#deleteTabData(tabId);
      }
    });
    browser.tabs.onActivated.addListener(async tabInfo => {
      if (tabInfo.windowId === this.#currentWindowId) {
        const tab = await this.#getTab(tabInfo.tabId);
        this.#sendTabShareable(tab);
      }
    });

    browser.browserAction.setBadgeBackgroundColor({
      "color": [0, 0, 0, 0]
    })
  }

  #deleteTabData(tabId) {
    delete this.#tabs[tabId];
    browser.browserAction.setBadgeText({
      text: '',
      tabId
    });
  }

  async #setTabData(tabId, actors) {
    this.#tabs[tabId] = actors;
    await browser.browserAction.setBadgeText({
      text: "🟢",
      tabId
    });

    this.#sendActorsDetected();
  }

  async stateChanged() {
    this.#sendDataToCurrentPort();

    if (this.state === STATE_AUTH_FAILED) {
      browser.browserAction.setBadgeText({
        text: "🟢"
      });

      if (!isChrome) {
        await browser.browserAction.openPopup();
      }
    }
  }

  async #panelConnected(port) {
    log("Panel connected");

    // Overwrite any existing port. We want to talk with 1 single popup.
    this.#currentPort = port;

    // Let's reset the badge icon
    await browser.browserAction.setBadgeText({
      text: ''
    });

    // Let's send the initial data.
    port.onMessage.addListener(async message => {
      log("Message received from the panel", message);
      this.sendMessage(message.type, message.data);
    });

    port.onDisconnect.addListener(_ => {
      log("Panel disconnected");
      this.#currentPort = null;
    });

    await this.#sendDataToCurrentPort();

    // Sending the pending messages.
    while (this.#messageQueue.length && this.#currentPort) {
      await this.#currentPort.postMessage(this.#messageQueue.splice(0, 1)[0]);
    }
    this.#messageQueue.splice(0);
  }

  async #sendDataToCurrentPort() {
    log("Update the panel");
    if (this.#currentPort) {
      return this.#currentPort.postMessage({
        type: 'stateChanged',
        state: this.state,
      });
    }
  }

  async handleEvent(type, data) {
    switch (type) {
      case 'mastoLists': {
        if (this.#currentPort) {
          this.#currentPort.postMessage({
            type,
            ...data,
          });
        }

        break;
      }

      case "shareURL":
        return this.#sendOrQueueAndPopup({
          type: "share",
          url: data,
        });

      case 'postResult':
        return this.#sendOrQueueAndPopup({
          type: "postResult",
          url: data,
        });

      case 'shareCurrentPage': {
        const tabs = await this.#activeTabs();
        return this.#sendOrQueueAndPopup({
          type: "share",
          url: tabs.length && (tabs[0].url.startsWith('http://') || tabs[0].url.startsWith('https://')) ? tabs[0].url : '',
        });
      }

      case 'replyStatus':
        return this.#sendOrQueueAndPopup({
          type: "share",
          status: data
        });

      case 'apActorDetected':
        return this.#setTabData(data.tabId, data.actors);

      case 'detectActors':
        return this.#sendActorsDetected();

      case 'urlShareable': {
        const tabs = await this.#activeTabs();
        return this.#sendTabShareable(tabs[0]);
      }

      case 'followActor': {
        return Object.entries(this.#tabs).forEach(entry => this.#tabs[entry[0]] = entry[1].filter(account => account.id !== data));
      }

      case 'timelineRefreshNeeded': {
        if (this.#currentPort) {
          this.sendMessage("fetchLists");
          return;
        }

        return browser.browserAction.setBadgeText({
          text: "🟢"
        });
      }

      case 'reblogCompleted':
      case 'unreblogCompleted':
      case 'bookmarkCompleted':
      case 'unbookmarkCompleted':
      case 'favouriteCompleted':
      case 'unfavouriteCompleted':
        if (this.#currentPort) {
          this.sendMessage("fetchLists");
        }
        return;

      case 'serverListFetched': {
        if (this.#currentPort) {
          this.#currentPort.postMessage({
            type: "serverListFetched",
            servers: data,
          });
        }
        break;
      }
    }
  }

  async #sendTabShareable(tab) {
    if (this.#currentPort) {
      return this.#currentPort.postMessage({
        type: "urlShareable",
        shareable: tab && (tab.url.startsWith('http://') || tab.url.startsWith('https://')),
      });
    }
  }

  async #sendActorsDetected() {
    if (this.#currentPort) {
      const tabs = await this.#activeTabs();

      this.#currentPort.postMessage({
        type: 'actorsDetected',
        actors: this.#tabs[tabs[0].id] || []
      });
    }
  }

  async #sendOrQueueAndPopup(msg) {
    if (this.#currentPort) {
      return this.#currentPort.postMessage(msg);
    }
    this.#messageQueue.push(msg);
    await browser.browserAction.openPopup();
  }

  async #activeTabs() {
    if (isChrome) {
      return new Promise(r => browser.tabs.query({
        active: true,
        windowId: this.#currentWindowId
      }, tabs => r(tabs)));
    }

    return browser.tabs.query({
      active: true,
      windowId: this.#currentWindowId
    });
  }

  async #getTab(tabId) {
    if (isChrome) {
      return new Promise(r => browser.tabs.get(tabId, data => r(data)));
    }

    return browser.tabs.get(tabId);
  }

}