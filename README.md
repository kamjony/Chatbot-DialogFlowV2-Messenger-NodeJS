# Chatbot-DialogFlowV2-Messenger-NodeJS
This is a dialogflow chatbot for facebook messenger using NodeJS


1) Download the repo. Run terminal on the project directory. 
2) Use command 'npm init'. Follow on-screen instrcutions.
3) Next run commande 'npm install' to install package-lock.json file
4) To install all project dependencies. Run command 'npm install body-parser dialogflow express pg request uuid --save'
5) Upload files to a server like heroku or use ngrok.
6) I assume you already have a facebook page. Visit developers.facebook.com, create an app. From the product section, add Messenger.
7) Inside messenger settings, you need to connect your facebook page to your facebook developers app. 
8) On access token, link your facebook page and generate an access token, copy it and paste it in your config.js file.
9) Scroll down to webhook. To configure the webhook, get the url of your file uploaded on a server. Copy/paste url in callback url section and give any string as a Verify token. Use the same verify token string in your config.js file.
10) Inside webhook section, click Edit subscriptions and tick messages, messaging_postbacks.
11) Get the facebook app secret from Settings->Basic. Copy/Paste it into your config.js file.
12) I will assume you already created a dialogflow agent. Go to agent settings, copy the ProjectID and paste it into GOOGLE_PROJECT_ID of your config.js file.
13) To get GOOGLE_CLIENT_EMAIL & GOOGLE_PRIVATE_KEY, click on service account link(under project id). It will redirect you to Google Cloud Platform. Find your service account for your dialogflow agent, Create a key and download the file. Copy the email and private from that file to your config.js file.

If you have done everything correctly, your messenger is now hooked to a dialogflow agent.
