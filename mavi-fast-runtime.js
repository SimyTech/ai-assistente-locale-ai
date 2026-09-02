import { answerFastLocalData } from "./lib/mavi-fast-data.js";

window.MaviFastData = Object.freeze({
  answer(message, data) {
    return answerFastLocalData(message, data);
  }
});

