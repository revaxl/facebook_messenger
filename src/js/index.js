import {
  APP_ID,
  VERSION,
  SOCKETIO_URL
} from './config';
import FacebookController from './controller/FacebookController';
import ErrorController from './controller/ErrorController';
import notifier from './controller/NotificationController';
import renderer from './view/renderer';
import ls from './model/localstorage';
import io from 'socket.io-client';
import { throttle } from 'lodash/function';

const fb = new FacebookController(APP_ID, VERSION);
const errorController = new ErrorController();
const socket = io(SOCKETIO_URL);

// NOTE experiment => infinite chat scroll

const chat_block = document.querySelector('.chat__body');
chat_block.addEventListener('scroll', throttle(loadMoreMessages, 500, { 'leading': false }));

async function loadMoreMessages(e) {
  if (chat_block.scrollTop === 0) {
    const result = await fb.loadMoreMessages();
    console.log(result);

    if (result.done) return console.log(result.done);

    renderer.showLoader();
    const sender = ls.loadFromLocalStorage('current_sender');
    renderer.renderConversationMessages(result, sender.id, false);
    if (result.paging.next) {
      console.log('has next:', result.paging.next);
      fb.chat_pagination.next = result.paging.next;
    } else {
      fb.chat_pagination.next = '';
    }

    if (result.paging.previous) {
      console.log('has previous:', result.paging.previous);
      fb.chat_pagination.previous = result.paging.previous;
    } else {
      fb.chat_pagination.previous = '';
    }
    
    chat_block.scrollTop += 200; // add some space just so the user can scroll up again and load more messages 
    renderer.hideLoader();
  }
} 

// end experiment

// connect to the socketio server to receive the message from facebook
socket.on('new_message', function (data) {
  console.log('new message:', data);
  updateCurrentConversation(data.message[0]);
});

// initialize the send form for our input
document.querySelector('#send_form').addEventListener('submit', sendMessage);

// first init the controller and get the FB instance 
async function init() {
  try {
    const response = await fb.init();
    if (response.status !== 'connected')
      throw new Error('not connected');
    // after init, check for the token in localstorage, if not found then in the server
    // and retrieve if found or get new one
    // fb.setToken(response.authResponse.accessToken);
    let token;
    let token_from_server;

    // always assume that someone else was using the computer and the token has been changed
    token = checkForTokenInLocal();
    token_from_server = await checkForTokenInServer();
    console.log('token from local:', token);
    console.log('token from server', token_from_server);
    
    if (token_from_server === "") {
      // if there is no token in db then get the current one from the login process and save it
      try {
        fb.setToken(response.authResponse.accessToken);
        const long_lived_token = await getNewLongLivedToken();
        console.log(long_lived_token);
        fb.setToken(long_lived_token);
      } catch (error) {
        fb.setToken(response.authResponse.accessToken);
        console.log('cant save llt: ', error);
      }
    } else {
      // we got the token from the server successfully
      fb.setToken(token_from_server);
    }
    
    // const declined_permissions = await checkForDeclinedPermissions();
    // console.log(declined_permissions);
    // if (declined_permissions.length !== 0) {
    //   alert('user declined: ', declined_permissions);
    // }

    // get the user pages
    await checkUserPages();
    
    // check if the user doesnt have any subed page
    if (Object.keys(fb.user_subscribed_page).length === 0 && fb.user_subscribed_page.constructor === Object) {
      return;
    }

    await checkPageConversations();

  } catch (error) {
    errorController.handleError(error);
    console.error('cant init FB api ', error);
  }
};

const checkForTokenInLocal = () => {
  try {
    return fb.getTokenFromLocalStorage();
  } catch (error) {
    errorController.handleError(error);
    console.log('checkForTokenInLocal error', error);
  }
}

const checkForTokenInServer = async () => {
  try {
    return await fb.checkBackendForToken().then(response => response.text());
  } catch (error) {
    errorController.handleError(error);
    console.log('checkForTokenInServer error', error);
  }
}

const getNewLongLivedToken = async () => {
  try {
    return await fb.getLongLivedToken().then(response => response.text());
  } catch (error) {
    console.log('getNewLongLivedToken error', error);
  }
}

const checkForDeclinedPermissions = async () => {
  try {
    return await fb.checkForDeclinedPermissions();
  } catch (error) {
    console.log('checkfordeclinedpermission error', error);
  }
} 

const getUserPages = async () => {
  try {
    const pages = await fb.getUserPages();
    console.log(pages);
    return pages;
  } catch (error) {
    errorController.handleError(error);
    console.log('getUserPages error', error);
  }
}

const checkForSubedPage = () => {
  try {
    return fb.checkForSubedPage();
  } catch (error) {
    // console.log('checkForSubedPage error', error);
    errorController.handleError(error);
  }
}

const checkForSubedPageFromDB = async () => {
  try {
    return await fb.checkForSubedPageFromDB();
  } catch (error) {
    errorController.handleError(error);
    console.log('checkForSubedPageFromDB error', error);
  }
}

const checkForSubedPageByApi = () => {
  try {
    return fb.checkForSubedPageByApi((error, response) => {
      if (error) return console.log(error); // nothing to do here
      return response;
    });
  } catch (error) {
    errorController.handleError(error);
    console.log('checkForSubedPageByApi error', error);
  }
}

const getPageConversations = async () => {
  return await fb.getPageConversations();
  // try {
  // } catch (error) {
  //   errorController.handleError(error);
  //   console.log('getPageConversations error', error);
  // }
}

// IMPORTANT fix this issue: not showing the subed page if ls is empty
const checkUserPages = async () =>  {
  try {
    const pages = await getUserPages();
    var subed_page_from_api;
    if (pages.length === 0) return renderer.showNoPageAlert();
    // after getting user pages, check if one of the page is subscribed
    const subed_page = await checkForSubedPage();
    console.log('subed_page', subed_page);
    if (!subed_page || subed_page.error) {
      console.log('no subed page in ls');
      // no page is subed and saved in localstorage, check in the DB then we check using the API
      const subed_page_from_db = await checkForSubedPageFromDB();
      console.log('subed page from db: ', subed_page_from_db);
      if (!subed_page_from_db || subed_page_from_db.error) {
        subed_page_from_api = checkForSubedPageByApi();
        console.log('subedpage from api', subed_page_from_api);
        console.log('pages.... ', pages);
        if (!subed_page_from_api || subed_page_from_api.error || Object.keys(subed_page_from_api).length === 0) {
          renderer.renderUserPages(pages, addListenerToPageNodes);
        } else {
          console.log('subed pagr form api');
          fb.setUserSubedPage(subed_page_from_api);
          renderer.renderUserSubedPage(subed_page_from_api, addListenerToPageNodes);
        }
      } else {
        // render the subed page we got from the db
        fb.setUserSubedPage(JSON.parse(subed_page_from_db));
        renderer.renderUserSubedPage(JSON.parse(subed_page_from_db), addListenerToPageNodes);
      }
    } else {
      fb.setUserSubedPage(subed_page);
      renderer.renderUserSubedPage(subed_page, addListenerToPageNodes);
    }
  } catch (error) {
    errorController.handleError(error);
    console.log('error checking user pages: ', error);
  }
}

const checkPageConversations = async () => {
  // try {
  const conversations = await getPageConversations();
  fb.getAllSenders(conversations.data, conversation => {
    console.log(conversation);
    renderer.renderPageConversation(conversation, addListenerToConversationNodes)
  });

  if (conversations.paging.next) {
    console.log('has next:', conversations.paging.next);
    // enable next button
    const next_button = document.querySelector('#next');
    next_button.classList.remove('btn-default', 'disabled');
    next_button.classList.add('btn-primary');
    next_button.removeAttribute('disabled');
  }
  if (conversations.paging.previous) {
    console.log('has previous:', conversations.paging.previous);
    // enable previous button
    const prev_button = document.querySelector('previous');
    prev_button.classList.remove('btn-default', 'disabled');
    prev_button.classList.add('btn-primary');
    prev_button.removeAttribute('disabled');
  }
  // renderer.renderPageConversations(conversations, addListenerToConversationNodes);
  // } catch (error) {
  //   errorController.handleError(error);
  //   console.log('checkPageConversations error', error);
  // }
}

/**
 * attach event listeners to the page nodes
 *
 */
const addListenerToPageNodes = () => {
  document.querySelectorAll('.sub').forEach(node => {
    node.addEventListener('click', handleSubFunction);
  });
}

/**
 * attach event listeners to the conversation nodes
 *
 */
const addListenerToConversationNodes = () => {
  document.querySelectorAll('.conversation').forEach(node => {
    node.addEventListener('click', getMessages);
  });
}

const handleSubFunction = (e) => {
  fb.handleSub(e)
    .then(response => {
      console.log('subscribe/unsubscribe:', response);
      if (response.subscribe) {
        console.log('subscribed');
        checkUserPages();
        checkPageConversations();
        saveSubedPageInDB();
        notifier.showSuccessNotification('subscribed successfuly');
      }
      else if (response.unsubscribe) {
        console.log('unsubscribe');
        renderer.renderUserPages(fb.user_pages, addListenerToPageNodes);
        renderer.clearConversationList();
        renderer.clearMessageList();
        removeSubedPageFromDB();
        notifier.showSuccessNotification('unsubscribed successfuly');
      }
      else {
        throw new Error(response);
      }
    })
    .catch(error => {
      console.log('error subscribe:', error);
      errorController.handleError(error.error);
    });
}

const saveSubedPageInDB = async () => {
  try {
    await fb.saveSubedPageInDB();
  } catch (error) {
    console.log('saveSubedPageInDB error', error);
    errorController.handleError(error);
  }
}

const removeSubedPageFromDB = async () => {
  try {
    await fb.removeSubedPageFromDB();
  } catch (error) {
    console.log('removeSubedPageFromDB error', error);
    errorController.handleError(error);
  }
}

/**
 * fetch the messages of the current conversation from the facebook api
 *
 * @param {event} e
 */
const getMessages = (e) => {
  e.preventDefault();
  // show the loader here to tell the user we're getting the messages
  renderer.showLoader();
  fb.getConversationMessages(e).then( async response => {
      console.log('conv messages', response);
      const sender = ls.loadFromLocalStorage('current_sender');
      renderer.renderConversationMessages(response.messages, sender.id);
      renderer.showInput();
      checkForPagination(response);
      jumpToLastMessage();
      renderer.hideLoader();
    })
    .catch(error => {
      console.log('conv message error ', error);
      errorController.handleError(error);
    });
}

function checkForPagination(response) {
  if (response.messages.paging.next) {
    console.log('has next:', response.messages.paging.next);
    fb.chat_pagination.next = response.messages.paging.next;
  } else {
    fb.chat_pagination.next = '';
  }
  if (response.messages.paging.previous) {
    console.log('has previous:', response.messages.paging.previous);
    fb.chat_pagination.previous = response.messages.paging.previous;
  } else {
    fb.chat_pagination.previous = '';
  }
}

function sendMessage(e) {
  e.preventDefault();
  // console.log(e);
  // TODO handle:
  // - message not coming from our form
  // - empty message (DONE)
  // - sending message by pressing enter (DONE)
  const form_data = new FormData(e.target);
  console.log(form_data.get('message'));
  if (form_data.get('message').trim() === '') {
    console.log('message is empty');
    alert('write something first');
    return;
  }
  fb.sendMessage(form_data, (error, response) => {
    if (error) return console.log('cant send message', error);
    renderer.renderSentMessage(form_data.get('message'));
    document.querySelector('#send_form').reset();
    jumpToLastMessage();
  });
}

const updateCurrentConversation = (message) => {
  fb.updateConversationMessages(message, () => {
    fb.getPageConversations()
      .then(response => {
        console.log(response);
        fb.getAllSenders(conversations, conversation => {
          console.log(conversation); renderer.renderPageConversation(conversation, addListenerToConversationNodes)
        });
      })
      .catch(error => {
        errorController.handleError(error);
      });
  });
}

const jumpToLastMessage = () => {
  // TODO add condition to jump to last message only if the user close to the end of chat height
  // scroll the chat to the last message received
  chat_block.scrollTop = chat_block.scrollHeight + chat_block.clientHeight;
}

init();
