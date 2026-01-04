import { generateDynamicCard, closeBrowser } from './src/image-generator.js';
import fs from 'fs';

const mockItem = {
  "modules": {
    "module_author": {
      "name": "七濑Unia",
      "face": "https://i2.hdslb.com/bfs/face/99a03fc75ad7246a86a8e8f5770417be9b650ca9.jpg",
      "pub_time": "昨天 09:26"
    },
    "module_dynamic": {
      "desc": null,
      "major": {
        "type": "MAJOR_TYPE_OPUS",
        "opus": {
          "summary": {
            "text": "早早早又是12小时精致睡眠！爽！\n昨天胃一直痛痛的但不是胃炎那种痛，去检查发现因为久坐+坐姿不正导致后背骨头有点错位[七濑Unia_哼哼啊啊]咔哒几声正完骨之后轻松多了！医生让我播一个小时就站起来一会儿（）我努力\n⭐今天大概下午234点来补个昨天的周末点歌回~具体几点到时候提前发动态吧\n",
            "rich_text_nodes": [
              {
                "text": "早早早又是12小时精致睡眠！爽！\n昨天胃一直痛痛的但不是胃炎那种痛，去检查发现因为久坐+坐姿不正导致后背骨头有点错位",
                "type": "RICH_TEXT_NODE_TYPE_TEXT"
              },
              {
                "text": "[七濑Unia_哼哼啊啊]",
                "type": "RICH_TEXT_NODE_TYPE_EMOJI",
                "emoji": {
                  "icon_url": "https://i0.hdslb.com/bfs/garb/6504344dfa744659b743c0843c111f9647453b70.png"
                }
              },
              {
                "text": "咔哒几声正完骨之后轻松多了！医生让我播一个小时就站起来一会儿（）我努力\n⭐今天大概下午234点来补个昨天的周末点歌回~具体几点到时候提前发动态吧",
                "type": "RICH_TEXT_NODE_TYPE_TEXT"
              },
              {
                "text": "\n",
                "type": "RICH_TEXT_NODE_TYPE_TEXT"
              }
            ]
          },
          "pics": [
            {
              "url": "http://i0.hdslb.com/bfs/new_dyn/f3887ed897fbd7d2fb81c873eae00791353361863.gif",
              "width": 500,
              "height": 500
            }
          ]
        }
      }
    }
  }
};

async function run() {
    try {
        console.log('Generating card with mock OPUS data...');
        const buffer = await generateDynamicCard(mockItem);
        fs.writeFileSync('test-emoji-output-mock.png', buffer);
        console.log('Image saved to test-emoji-output-mock.png');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await closeBrowser();
    }
}

run();
