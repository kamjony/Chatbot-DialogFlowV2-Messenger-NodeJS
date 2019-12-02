'use strict';

const dialogflow = require('dialogflow');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const pg = require('pg');
pg.defaults.ssl = true;
const userService = require('./user-service');
// Import the JSON to gRPC struct converter
const structjson = require('./structjson.js');

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
  throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
  throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.GOOGLE_PROJECT_ID) {
  throw new Error('missing GOOGLE_PROJECT_ID');
}
if (!config.DF_LANGUAGE_CODE) {
  throw new Error('missing DF_LANGUAGE_CODE');
}
if (!config.GOOGLE_CLIENT_EMAIL) {
  throw new Error('missing GOOGLE_CLIENT_EMAIL');
}
if (!config.GOOGLE_PRIVATE_KEY) {
  throw new Error('missing GOOGLE_PRIVATE_KEY');
}
if (!config.FB_APP_SECRET) {
  throw new Error('missing FB_APP_SECRET');
}

app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
  verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
  extended: false
}));

// Process application/json
app.use(bodyParser.json());

const credentials = {
  client_email: config.GOOGLE_CLIENT_EMAIL,
  private_key: config.GOOGLE_PRIVATE_KEY,
};

const sessionClient = new dialogflow.SessionsClient(
  {
    projectId: config.GOOGLE_PROJECT_ID,
    credentials
  }
);

const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
  res.send('Hello world, I am a chat bot')
});

// for Facebook verification
app.get('/webhook/', function (req, res) {
  console.log("request");
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }
});


app.post('/webhook/', function (req, res) {
  var data = req.body;
  console.log(JSON.stringify(data));
  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;
      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });
    // Assume all went well.
    // You must send back a 200, within 20 seconds
    res.sendStatus(200);
  }
});


function setSessionAndUser(senderID) {
  if (!sessionIds.has(senderID)) {
    sessionIds.set(senderID, uuid.v1());
  }
  if (!usersMap.has(senderID)) {
    userService.addUser(function(user){
      usersMap.set(senderID, user);
    }, senderID);
  }
}


function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  setSessionAndUser(senderID);

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;
  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    handleEcho(messageId, appId, metadata);
    return;
  } else if (quickReply) {
    handleQuickReply(senderID, quickReply, messageId);
    return;
  }
  if (messageText) {
    sendToDialogFlow(senderID, messageText);//send message to api.ai
  } else if (messageAttachments) {
    handleMessageAttachments(messageAttachments, senderID);
  }
}


function handleMessageAttachments(messageAttachments, senderID){
  //for now just reply
  sendTextMessage(senderID, "Attachment received. Thank you.");
}


function handleQuickReply(senderID, quickReply, messageId) {
  var quickReplyPayload = quickReply.payload;
  console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
  //send payload to api.ai
  sendToDialogFlow(senderID, quickReplyPayload);
}


//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
  // Just logging message echoes to console
  console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}


function handleDialogFlowAction(sender, action, messages, contexts, parameters) {
  switch (action) {
    case "input.welcome":
    let user = usersMap.get(sender);
    sendTypingOn(sender);
    sendTextMessage(sender, "Hi, " + user.first_name + ". Welcome to Skitto.")
    handleMessages(messages, sender);
    break;

    case "rate.action":
    firstRateFunction();
    async function firstRateFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondRateFunction();
    }
    async function secondRateFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'PRICE_SECOND_EVENT');
    }
    break;

    case "where.action":
    firstWhereFunction();
    async function firstWhereFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondWhereFunction();
    }
    async function secondWhereFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'WHERE_SECOND_EVENT');
    }
    break;

    case "ongoingdeals.action":
    firstOngoingFunction();
    async function firstOngoingFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondOngoingFunction();
    }
    async function secondOngoingFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'ONGOING_SECOND_EVENT');
    }
    break;

    case "data.packs.action":
    firstDataFunction();
    async function firstDataFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondDataFunction();
    }
    async function secondDataFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'DATA_SECOND_EVENT');
    }
    break;

    case "others.action":
    firstOtherFunction();
    async function firstOtherFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondOtherFunction();
    }
    async function secondOtherFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'OTHERS_SECOND_EVENT');
    }
    break;

    case "start.again.action":
    firstAgainFunction();
    async function firstAgainFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondAgainFunction();
    }
    async function secondAgainFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'AGAIN_SECOND_EVENT');
    }
    break;

    case "reload.action":
    firstReloadFunction();
    async function firstReloadFunction(){
      sendTypingOn(sender);
      handleMessages(messages, sender);
      await secondReloadFunction();
    }
    async function secondReloadFunction(){
      await resolveAfterXSeconds(3);
      sendTypingOn(sender);
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, sender, 'RELOAD_SECOND_EVENT');
    }
    break;

    case "talk.human":
    passThreadControl(sender);
    sendTextMessage(sender, "Transferring to Human Agent. Please Wait!");
    break;

    default:
    handleMessages(messages, sender);
  }
}


function passThreadControl (senderID) {
  console.log('PASSING THREAD CONTROL')
  request(
    {
      uri: "https://graph.facebook.com/v2.6/me/pass_thread_control",
      qs: { access_token: config.FB_PAGE_TOKEN },
      method: "POST",
      json: {
        recipient: {
          id: senderID
        },
        target_app_id: config.FB_PAGE_INBOX_ID // ID in the page inbox setting under messenger platform
      }
    }
  );
}


function handleMessage(message, sender) {
  switch (message.message) {
    case "text": //text
    message.text.text.forEach((text) => {
      if (text !== '') {
        sendTextMessage(sender, text);
      }
    });
    break;
    case "quickReplies": //quick replies
    let replies = [];
    message.quickReplies.quickReplies.forEach((text) => {
      let reply =
      {
        "content_type": "text",
        "title": text,
        "payload": text
      }
      replies.push(reply);
    });
    sendQuickReply(sender, message.quickReplies.title, replies);
    break;
    case "image": //image
    sendImageMessage(sender, message.image.imageUri);
    break;
  }
}


function handleCardMessages(messages, sender) {

  let elements = [];
  for (var m = 0; m < messages.length; m++) {
    let message = messages[m];

    let buttons = [];
    for (var b = 0; b < message.card.buttons.length; b++) {
      let isLink = (message.card.buttons[b].postback.substring(0, 4) === 'http');
      let button;
      if (isLink) {
        button = {
          "type": "web_url",
          "title": message.card.buttons[b].text,
          "url": message.card.buttons[b].postback
        }
      } else {
        button = {
          "type": "postback",
          "title": message.card.buttons[b].text,
          "payload": message.card.buttons[b].postback
        }
      }
      buttons.push(button);
    }


    let element = {
      "title": message.card.title,
      "image_url":message.card.imageUri,
      "subtitle": message.card.subtitle,
      "buttons": buttons
    };
    elements.push(element);
  }
  sendGenericMessage(sender, elements);
}


function handleMessages(messages, sender) {
  let timeoutInterval = 1100;
  let previousType ;
  let cardTypes = [];
  let timeout = 0;
  for (var i = 0; i < messages.length; i++) {

    if ( previousType == "card" && (messages[i].message != "card" || i == messages.length - 1)) {
      timeout = (i - 1) * timeoutInterval;
      setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
      cardTypes = [];
      timeout = i * timeoutInterval;
      setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
    } else if ( messages[i].message == "card" && i == messages.length - 1) {
      cardTypes.push(messages[i]);
      timeout = (i - 1) * timeoutInterval;
      setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
      cardTypes = [];
    } else if ( messages[i].message == "card") {
      cardTypes.push(messages[i]);
    } else  {

      timeout = i * timeoutInterval;
      setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
    }

    previousType = messages[i].message;

  }

}


function handleDialogFlowResponse(sender, response) {
  let responseText = response.fulfillmentMessages.fulfillmentText;
  let messages = response.fulfillmentMessages;
  let action = response.action;
  let contexts = response.outputContexts;
  let parameters = response.parameters;

  sendTypingOff(sender);

  if (isDefined(action)) {
    handleDialogFlowAction(sender, action, messages, contexts, parameters);
  } else if (isDefined(messages)) {
    handleMessages(messages, sender);
  } else if (responseText == '' && !isDefined(action)) {
    //dialogflow could not evaluate input.
    sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
  } else if (isDefined(responseText)) {
    sendTextMessage(sender, responseText);
  }
}


async function sendToDialogFlow(sender, textString, params) {
  sendTypingOn(sender);
  try {
    const sessionPath = sessionClient.sessionPath(
      config.GOOGLE_PROJECT_ID,
      sessionIds.get(sender)
    );
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: textString,
          languageCode: config.DF_LANGUAGE_CODE,
        },
      },
      queryParams: {
        payload: {
          data: params
        }
      }
    };
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    handleDialogFlowResponse(sender, result);
  } catch (e) {
    console.log('error');
    console.log(e);
  }
}


function sendTextMessage(recipientId, text) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: text
    }
  }
  callSendAPI(messageData);
}
/*
* Send an image using the Send API.
*
*/
function sendImageMessage(recipientId, imageUrl) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: imageUrl
        }
      }
    }
  };
  callSendAPI(messageData);
}
/*
* Send a button message using the Send API.
*
*/
function sendButtonMessage(recipientId, text, buttons) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text,
          buttons: buttons
        }
      }
    }
  };
  callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: elements
        }
      }
    }
  };
  callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
  timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "receipt",
            recipient_name: recipient_name,
            order_number: receiptId,
            currency: currency,
            payment_method: payment_method,
            timestamp: timestamp,
            elements: elements,
            address: address,
            summary: summary,
            adjustments: adjustments
          }
        }
      }
    };

    callSendAPI(messageData);
  }
  /*
  * Send a message with Quick Reply buttons.
  *
  */
  function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: text,
        metadata: isDefined(metadata)?metadata:'',
        quick_replies: replies
      }
    };
    callSendAPI(messageData);
  }
  /*
  * Send a read receipt to indicate the message has been read
  *
  */
  function sendReadReceipt(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      sender_action: "mark_seen"
    };
    callSendAPI(messageData);
  }
  /*
  * Turn typing indicator on
  *
  */
  function sendTypingOn(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      sender_action: "typing_on"
    };
    callSendAPI(messageData);
  }
  /*
  * Turn typing indicator off
  *
  */
  function sendTypingOff(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      sender_action: "typing_off"
    };
    callSendAPI(messageData);
  }
  /*
  * Call the Send API. The message data goes in the body. If successful, we'll
  * get the message id in a response
  *
  */
  function callSendAPI(messageData) {
    request({
      uri: 'https://graph.facebook.com/v3.2/me/messages',
      qs: {
        access_token: config.FB_PAGE_TOKEN
      },
      method: 'POST',
      json: messageData

    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var recipientId = body.recipient_id;
        var messageId = body.message_id;

        if (messageId) {
          console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
        } else {
          console.log("Successfully called Send API for recipient %s",
          recipientId);
        }
      } else {
        console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
      }
    });
  }
  /*
  * Postback Event
  *
  * This event is called when a postback is tapped on a Structured Message.
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
  *
  */
  function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    setSessionAndUser(senderID);
    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    switch (payload) {
      case 'GET_STARTED':
      greetUserText(senderID);
      break;
      case 'ABOUT':
      //get feedback with new jobs
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'ABOUT_EVENT');
      break;
      //this case is from the first welcome
      case 'PRICE':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'PRICE_EVENT');
      break;

      case 'WHERE_TO_GET':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'WHERE_EVENT');
      break;
      case 'ONGOING_DEALS':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'ONGOING_DEALS_EVENT');
      break;
      case 'DATA_PACKS':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'DATA_PACKS_EVENT');
      break;
      case 'OTHERS':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'OTHERS_EVENT');
      break;
      case 'CHAT_WITH_AGENT':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'CHAT_WITH_AGENT_EVENT');
      break;
      case 'RELOAD':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'RELOAD_EVENT');
      break;
      case 'START_AGAIN':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'START_AGAIN_EVENT');
      break;

      case 'BUY_SIM_BANGLA':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'BANGLA_BUY_EVENT');
      break;
      case 'ABOUT_BANGLA':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'BANGLA_ABOUT_EVENT', {'bangla_about_what': 'স্কিটটো'});
      break;
      case 'BANGLA_SIM_BUYING_OPTIONS':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'BANGLA_BUYOPTIONS_EVENT');
      break;
      case 'BANGLA_SIM_RATES':
      sendEventToDialogFlow(sessionIds, handleDialogFlowResponse, senderID, 'BANGLA_SIMRATES_EVENT');
      break;
      case 'NO_PAYLOAD_BANGLA':
      sendTextMessage(senderID, "আপনাকে যেতে দেখে দুঃখিত :(। আপনার প্রশ্নের সন্ধান না হলে দয়া করে লাইভ এজেন্টের সাথে সংযোগ করতে 'চ্যাট উইথ এজেন্ট' টাইপ করুন। স্কিটোর সাথে থাকার জন্য আপনাকে আবার ধন্যবাদ।");
      default:
      //unindentified payload
      sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
      break;
    }
    console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);
  }

  const sendEventToDialogFlow = async (sessionIds, handleDialogFlowResponse, sender, event, params = {}) => {
    const sessionPath = sessionClient.sessionPath(config.GOOGLE_PROJECT_ID, sessionIds.get(sender));
    const request = {
      session: sessionPath,
      queryInput: {
        event: {
          name: event,
          parameters: structjson.jsonToStructProto(params), //Dialogflow's v2 API uses gRPC. You'll need a jsonToStructProto method to convert your JavaScript object to a proto struct.
          languageCode: config.DF_LANGUAGE_CODE,
        },
      }
    };
    const responses = await sessionClient.detectIntent(request);

    const result = responses[0].queryResult;
    handleDialogFlowResponse(sender, result);

  }

  async function greetUserText(userID) {
    let user = usersMap.get(userID);
    if (!user) {
      await resolveAfterXSeconds(2);
      user = usersMap.get(userID);
    }

    if (user) {
      let responseText = "হ্যালো " + user.first_name + "! আমি স্কিটোর ভার্চুয়াল সহকারী। বাংলায় কথা বলতে 'হ্যালো' লিখুন। \nHello " + user.first_name + "! I am the virtual assistant of Skitto. To start the conversation in English, type 'Hello'."
      sendTextMessage(userID, responseText);
    } else {
      let responseText = "হ্যালো! আমি স্কিটোর ভার্চুয়াল সহকারী। বাংলায় কথা বলতে 'হ্যালো' লিখুন। \nHello! I am the virtual assistant of Skitto. To start the conversation in English, type 'Hello'."
      sendTextMessage(userID, responseText);
    }

  }

  async function resolveAfterXSeconds(x) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(x);
      }, x * 1000);
    });
  }
  /*
  * Message Read Event
  *
  * This event is called when a previously-sent message has been read.
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
  *
  */
  function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
  }
  /*
  * Account Link Event
  *
  * This event is called when the Link Account or UnLink Account action has been
  * tapped.
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
  *
  */
  function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
  }

  /*
  * Delivery Confirmation Event
  *
  * This event is sent to confirm the delivery of a message. Read more about
  * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
  *
  */
  function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
      messageIDs.forEach(function (messageID) {
        console.log("Received delivery confirmation for message ID: %s",
        messageID);
      });
    }

    console.log("All message before %d were delivered.", watermark);
  }

  /*
  * Authorization Event
  *
  * The value for 'optin.ref' is defined in the entry point. For the "Send to
  * Messenger" plugin, it is the 'data-ref' field. Read more at
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
  *
  */
  function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam,
    timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
  }

  /*
  * Verify that the callback came from Facebook. Using the App Secret from
  * the App Dashboard, we can verify the signature that is sent with each
  * callback in the x-hub-signature field, located in the header.
  *
  * https://developers.facebook.com/docs/graph-api/webhooks#setup
  *
  */
  function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
      throw new Error('Couldn\'t validate the signature.');
    } else {
      var elements = signature.split('=');
      var method = elements[0];
      var signatureHash = elements[1];

      var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
      .update(buf)
      .digest('hex');

      if (signatureHash != expectedHash) {
        throw new Error("Couldn't validate the request signature.");
      }
    }
  }


  function isDefined(obj) {
    if (typeof obj == 'undefined') {
      return false;
    }

    if (!obj) {
      return false;
    }

    return obj != null;
  }

  // Spin up the server
  app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'))
  })
