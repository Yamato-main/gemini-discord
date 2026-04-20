const { prepareDiscordMessageContent } = require('./dist/daemon.cjs');
prepareDiscordMessageContent("![image](/Users/yamato/Pictures/Anime:Manga:JP\\ video\\ Game\\ Art/1753554867571619.jpg)")
  .then(res => console.log(JSON.stringify(res, null, 2)));
