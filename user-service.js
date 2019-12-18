'use strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');
pg.defaults.ssl = true;

module.exports = {

    addUser: function(callback, userId) {
        request({
            uri: 'https://graph.facebook.com/v3.2/' + userId,
            qs: {
                access_token: config.FB_PAGE_TOKEN
            }

        }, function (error, response, body) {
            if (!error && response.statusCode == 200) {

                var user = JSON.parse(body);
                if (user.first_name.length > 0) {

                    callback(user);
                } else {
                    console.log("Cannot get data for fb user with id",
                        userId);
                }
            } else {
                console.error(response.error);
            }

        });
    }

}
