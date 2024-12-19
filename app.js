const axios = require("axios");
const xml2js = require("xml2js");
const { Wcferry } = require("@zippybee/wechatcore");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const token = "123";
//翻译提示词
const translationPromots = `指令：将输入的中文翻译成英文输出，中文输入时候直接翻译，无需修正，无需优化。将输入的英文翻译成中文输出，若输入的英文有语法或拼写错误请修正后输出，若输入的英文有其他表达方式请列举常用的一种。翻译需要结合上下文语境,输入示例请勿当作上下文。
输入格式：中文内容/英文内容
输出格式：
输入类型：中文/英文
翻译结果：翻译后的内容
原输入的英文内容是否需要修正：是/否
修正结果：修正后的内容
原输入的英文是否有其他常用表达方式：是/否
常用表达：常用的表达内容

输入示例1：你今天过得怎么样？
输出示例1：
输入类型：中文
翻译结果：How was your day today?
原输入的英文内容是否需要修正：否
修正结果：无
原输入的英文是否有其他常用表达方式：否
常用表达：无

输入示例2：How was your day tody?
输出示例2：
输入类型：英文
翻译结果：你今天过得怎么样？
原输入的英文内容是否需要修正：是
修正结果：How was your day today？
原输入的英文是否有其他常用表达方式：是
常用表达：How's your day going?

输入示例3：你叫什么名字？
输出示例3：
输入类型：中文
翻译结果：What's your name?
原输入的英文内容是否需要修正：否
修正结果：无
原输入的英文是否有其他常用表达方式：否
常用表达：无

输入示例4：What's your name?
输出示例4：
输入类型：英文
翻译结果：你叫什么名字？
原输入的英文内容是否需要修正：否
修正结果：无
原输入的英文是否有其他常用表达方式：是
常用表达：Could you tell me your name?

明白就回复好的`;

//问答提示词
const questionAndAnswerPrompts = `指令：回答以下问题并输出结果，结果为纯文本格式。输入示例请勿当作上下文。
输入格式：这是一个问题
输出格式：回答内容

输入示例：三角形有几个边？
输出示例：三角形有三个边

明白就回复好的`;

//生成摘要提示词
const urlPrompts = `指令：生成生成一下内容的摘要，自行剔除非正文内容。输入示例请勿当作上下文。
输入格式：正文内容
输出格式：摘要内容

输入示例：⇧点蓝色字关注“央视新闻”11月11日19时48分许，广东珠海发生一起驾车冲撞市民重大恶性案件。12日，珠海市公安局发布警情通报，案件致35人死亡，43人受 伤。详情如下：▌本文来源：央视新闻微信公众号（ID：cctvnewscenter）©央视新闻
输出示例：11月11日19时48分许，广东珠海发生一起驾车冲撞市民重大恶性案件。12日，珠海市公安局发布警情通报，案件致35人死亡，43人受伤

明白就回复好的`;

//主程序==============================================================================
const client = new Wcferry();
client.start();
const isLogin = client.isLogin();
const userinfo = client.getUserInfo();
const userName = userinfo.name;
console.log(isLogin, userinfo);
const rooms = client.getChatRooms();

//消息处理
const off = client.listening(async (msg) => {
  //群名称
  let groupName = msg.isGroup
    ? rooms.find((room) => room.wxid === msg.roomId).name
    : "";
  //发送者
  let sender = msg.isGroup
    ? client.getAliasInChatRoom(msg.sender, msg.roomId)
    : client.getNickName(msg.sender);
  const senderVXID = msg.isGroup ? msg.roomId : msg.sender;

  //图片过滤，引用提取主要内容
  let fileredContent = msg.content;
  let isNeededToPass = false;
  let isShareUrl = false;
  if (
    msg.content.startsWith('<?xml version="1.0"?>') ||
    msg.content.startsWith("<msg>")
  ) {
    // 解析 XML 字符串
    const xmlResult = await processXML(msg.content);
    // 提取 cdnurl 和 md5
    const appmsgNode = xmlResult.msg.appmsg;
    const emojiNode = xmlResult.msg.emoji;
    const imgNode = xmlResult.msg.img;
    if (imgNode || emojiNode) {
      isNeededToPass = true;
    } else if (appmsgNode) {
      if (appmsgNode[0].url && appmsgNode[0].url[0]) {
        const url = appmsgNode[0].url[0];
        const wxUrlResult = await axios.get(url);
        const html = cheerio.load(wxUrlResult.data);
        const textContent = [];
        html("p").each((index, element) => {
          textContent.push(html(element).text().trim());
        });
        // 打印提取的文字内容
        fileredContent = textContent.join("");
        isShareUrl = true;
      } else {
        fileredContent = appmsgNode[0].title[0];
      }
    }
  } else if (
    msg.content.includes(" 拍了拍") ||
    msg.content.includes(" tickled")
  ) {
    isNeededToPass = true;
  } else if (fileredContent == `@${userName} 关闭`) {
    client.sendTxt(`好的，${userName}先退下了`, msg.roomId);
    isNeededToPass = true;
    off();
  }
  console.log("微信输入：\n", msg.content);
  if (isNeededToPass) return; //直接跳过
  console.log("GPT输入：\n", fileredContent);

  try {
    //判断问答类型
    let type = "";
    if (isShareUrl) {
      type = "URL";
    } else if (msg.isGroup) {
      if (fileredContent.startsWith(`@${userName}`)) {
        type = "QA";
      } else {
        type = "TRANS";
      }
    } else {
      type = "QA";
    }
    const content = await callChatGPT(token, senderVXID, fileredContent, type);
    if (type == "QA") {
      wxReply = content;
    } else if (type == "URL") {
      wxReply = `摘要:` + content;
    } else if (type == "TRANS") {
      wxReply = `${sender}:` + content;
    } else {
      wxReply = content;
    }
    client.sendTxt(wxReply, msg.roomId);
  } catch (err) {
    client.sendTxt("完蛋出问题了，原因如下：\n" + err, msg.roomId);
  }
});

//方法区==============================================================================

//发送GPT消息
async function callChatGPT(token, vxid, msg, type) {
  let promptContent;
  switch (type) {
    case "QA":
      promptContent = questionAndAnswerPrompts;
      break;
    case "TRANS":
      promptContent = translationPromots;
      break;
    case "URL":
      promptContent = urlPrompts;
      break;
    default:
      promptContent = msg;
      break;
  }
  // 检查文件是否存在，如果不存在则创建
  const filePath = path.join(__dirname, "users", `${vxid}-${type}.json`);
  let userContext = [];
  // 检查文件是否存在，如果不存在则创建
  if (!fs.existsSync(filePath)) {
    // 文件不存在，创建文件并写入初始内容
    try {
      fs.writeFileSync(filePath, ""); // 创建空文件
    } catch (err) {
      throw new Error(`文件创建出错: ${err.message}`);
    }
  } else {
    // 文件存在，读取文件内容
    try {
      const data = fs.readFileSync(filePath, "utf8");
      userContext = JSON.parse(data);
    } catch (err) {
      throw new Error(`文件读取出错: ${err.message}`);
    }
  }
  //读取文件，获取提示词字符个数，获取本次问答字符，获取文件后24566-提示词-本次问答 个字符，截取完整对话，添加提示词，发送给模型
  const promptMessage = [
    {
      role: "user",
      content: promptContent,
    },
    {
      role: "assistant",
      content: "好的",
    },
  ];
  const currentMessage = [{ role: "user", content: msg }];
  const promptLength = JSON.stringify(promptMessage).length;
  const currentLength = JSON.stringify(currentMessage).length;
  const splitLength = 10000 - promptLength - currentLength; //24566
  const userContentString = JSON.stringify(userContext);
  const splitMessageString = userContentString.slice(-splitLength);
  const firstUserIndex = splitMessageString.indexOf('{"role":"user",');
  const wholeDialog =
    firstUserIndex == -1
      ? JSON.parse(splitMessageString)
      : JSON.parse("[" + splitMessageString.slice(firstUserIndex));
  const submitMessage = [...wholeDialog, ...promptMessage, ...currentMessage];

  // console.log("splitLength：", splitLength);
  // console.log("userContentString长度：", userContentString.length);
  // console.log("splitMessageString长度：", splitMessageString.length);
  // console.log("提示词长度：", JSON.stringify(promptMessage).length);
  // console.log("完整对话长度：", JSON.stringify(wholeDialog).length);
  // console.log("本次问答长度：", JSON.stringify(currentMessage).length);
  // console.log("字符串长度：", JSON.stringify(submitMessage).length);

  let originalResult = "";
  try {
    const response = await axios({
      method: "post",
      url: "http://localhost:5006/v1/chat/completions", // 使用 OpenAI 的实际 API URL
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, // 替换为你的实际 API 密钥
      },
      data: {
        model: "gpt-4o-mini",
        messages: submitMessage,
        stream: false, // 不启用流式传输
      },
    });
    // 提取具体内容
    originalResult = response.data.choices[0]?.message?.content;
  } catch (err) {
    if (err.message.includes("403") || err.message.includes("429")) {
      throw new Error(`GPT调用出错: ${err.message},可能是CF验证问题`);
    } else if (err.message.includes("413")) {
      throw new Error(`GPT调用出错: ${err.message},可能是输入的字符串太长了`);
    } else {
      throw new Error(`GPT调用出错: ${err.message}`);
    }
  }
  console.log("GPT结果：\n", originalResult);
  // 对话保存记录
  userContext.push({
    role: "user",
    content: msg,
  });
  userContext.push({
    role: "assistant",
    content: originalResult,
  });

  try {
    fs.writeFileSync(filePath, JSON.stringify(userContext, null, 2), "utf8");
  } catch (err) {
    throw new Error(`文件写入出错: ${err.message}`);
  }
  if (originalResult) {
    //翻译结果优化
    if (type == "TRANS") {
      const regex =
        /输入类型：\s*(.*?)\s*\n翻译结果：\s*([\s\S]+?)\s*\n原输入的英文内容是否需要修正：\s*(.*?)\s*\n修正结果：\s*([\s\S]+?)\s*\n原输入的英文是否有其他常用表达方式：\s*(.*?)\s*\n常用表达：\s*([\s\S]*)/;
      const match = originalResult.match(regex);
      if (match) {
        const result = {
          inputType: match[1], // 输入类型
          translation: match[2], // 翻译结果
          needsCorrection: match[3], // 是否需要修正
          correction: match[4], // 修正结果
          hasOtherExpressions: match[5], // 是否有其他常用表达
          commonExpression: match[6], // 常用表达
        };
        let txtMsg = `${result.translation}`;
        if (result.inputType == "英文") {
          if (result.needsCorrection == "是") {
            txtMsg += `\n修正：${result.correction}`;
          }
          if (result.hasOtherExpressions == "是") {
            txtMsg += `\n优化：${result.commonExpression}`;
          }
        }
        return txtMsg;
      }
    }
    //问答结果优化
    else {
      return originalResult;
    }
  }
}

function parseXMLAsync(xmlData) {
  return new Promise((resolve, reject) => {
    const parser = new xml2js.Parser();
    parser.parseString(xmlData, (err, result) => {
      if (err) {
        reject(err); // 解析错误时返回拒绝的 Promise
      } else {
        resolve(result); // 解析成功时返回解析结果
      }
    });
  });
}

async function processXML(xmlData) {
  try {
    const result = await parseXMLAsync(xmlData);
    return result;
  } catch (error) {
    console.error("解析错误:", error);
  }
}
