// The emoji the icon picker offers, by group, with the words that find them (Pages and blocks,
// section 3.1). Each entry is "emoji name, more words".
const GROUPS: [string, string][] = [
  [
    'Smileys',
    '😀 grinning face, happy | 😃 smiley | 😄 smile | 😁 grin | 😅 sweat smile | 😂 tears of joy, laugh | 🙂 slight smile | 😉 wink | 😊 blush | 😍 heart eyes, love | 🤩 star struck | 😎 sunglasses, cool | 🤔 thinking | 😐 neutral face | 😴 sleeping | 😮 surprised | 😢 crying, sad | 😡 angry | 🥳 party face | 🤗 hug | 😇 halo, angel | 🤓 nerd',
  ],
  [
    'People',
    '👋 wave, hello | 👍 thumbs up, yes | 👎 thumbs down, no | 👏 clap | 🙌 raised hands | 🙏 folded hands, thanks, please | 💪 muscle, strong | 🤝 handshake, deal | ✌️ victory, peace | 👀 eyes, look | 🧠 brain | 👤 person | 👥 people, team, group | 🧑‍💻 technologist, laptop | 🧑‍⚕️ health worker, care, nurse | 🧑‍🏫 teacher | 🧑‍🍳 cook, chef | 👶 baby | 🧓 older person',
  ],
  [
    'Nature',
    '🌱 seedling, grow | 🌳 tree | 🌲 evergreen tree | 🌵 cactus | 🌸 cherry blossom, flower | 🌻 sunflower | 🍀 four leaf clover, luck | 🍁 maple leaf, autumn | 🌊 wave, ocean, water | 🔥 fire | ⭐ star | 🌙 moon, night | ☀️ sun | 🌈 rainbow | ❄️ snowflake, winter | ⚡ lightning, bolt | 🐶 dog | 🐱 cat | 🦊 fox | 🐝 bee | 🦋 butterfly | 🐢 turtle | 🐙 octopus',
  ],
  [
    'Food',
    '🍎 apple | 🍋 lemon | 🍓 strawberry | 🥑 avocado | 🥕 carrot | 🍞 bread | 🧀 cheese | 🍕 pizza | 🍔 burger | 🌮 taco | 🍣 sushi | 🍜 noodles, ramen | 🍰 cake | 🍪 cookie | 🍫 chocolate | ☕ coffee | 🍵 tea | 🧃 juice | 🎂 birthday cake',
  ],
  [
    'Activities',
    '⚽ football, soccer | 🏀 basketball | 🎾 tennis | 🏆 trophy, win | 🥇 gold medal, first | 🎯 target, goal | 🎮 video game | 🎲 dice, game | 🧩 puzzle piece | 🎨 palette, art, paint | 🎵 music note | 🎸 guitar | 🎬 clapper board, film | 📷 camera, photo | 🎉 party popper, celebrate | 🎁 gift, present | 🎈 balloon | 🏃 running | 🧘 yoga, meditate | 🚴 cycling, bike',
  ],
  [
    'Travel and places',
    '🚀 rocket, launch, space | ✈️ airplane, flight, travel | 🚗 car | 🚌 bus | 🚲 bicycle | 🚢 ship | 🗺️ map | 🧭 compass | 🏠 house, home | 🏢 office building | 🏥 hospital | 🏫 school | 🏖️ beach | ⛰️ mountain | 🏕️ camping | 🌍 globe, earth, world | 🌆 city | ⛺ tent',
  ],
  [
    'Objects',
    '📄 page, document | 📝 memo, note, write | 📚 books, library | 📖 open book, read | 📒 notebook | 📌 pushpin, pin | 📎 paperclip | ✏️ pencil | 📁 folder | 🗂️ index dividers | 📅 calendar, date | 📊 bar chart | 📈 chart up, growth | 💡 light bulb, idea | 🔑 key | 🔒 lock | 🔔 bell, notification | 📣 megaphone, announcement | 💬 speech balloon, chat | ✉️ envelope, mail, email | 📞 telephone, phone, call | 💻 laptop, computer | 📱 mobile phone | ⏰ alarm clock, time | ⌛ hourglass | 🧰 toolbox, tools | 🔧 wrench, fix | ⚙️ gear, settings | 🧪 test tube, lab | 💊 pill, medicine | 🩺 stethoscope, doctor | 💰 money bag | 💳 credit card | 🛒 shopping cart | 📦 package, box',
  ],
  [
    'Symbols',
    '❤️ red heart, love | 🧡 orange heart | 💛 yellow heart | 💚 green heart | 💙 blue heart | 💜 purple heart | ✅ check mark, done | ❌ cross mark, no | ⚠️ warning | ❗ exclamation mark | ❓ question mark | 💯 hundred points | ♻️ recycle | 🔴 red circle | 🟢 green circle | 🔵 blue circle | 🏁 chequered flag, finish | 🚩 red flag | 🔗 link | ➕ plus, add | ✨ sparkles',
  ],
];

export interface Emoji {
  emoji: string;
  name: string;
  words: string[];
}

function parse(list: string): Emoji[] {
  return list.split('|').map((entry) => {
    const [emoji = '', ...rest] = entry.trim().split(' ');
    const words = rest
      .join(' ')
      .split(',')
      .map((word) => word.trim());
    return { emoji, name: words[0] ?? '', words };
  });
}

export const EMOJI_GROUPS = GROUPS.map(([name, list]) => ({ name, items: parse(list) }));
const ALL = EMOJI_GROUPS.flatMap((group) => group.items);

/** Emoji whose words start with what's typed ("rock" finds 🚀), best matches first. */
export function searchEmoji(query: string): Emoji[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return [];
  const score = (item: Emoji) => {
    if (item.name.startsWith(typed)) return 0;
    const parts = item.words.flatMap((word) => word.split(' '));
    if (parts.some((part) => part.startsWith(typed))) return 1;
    return item.words.some((word) => word.includes(typed)) ? 2 : 3;
  };
  return ALL.map((item) => ({ item, at: score(item) }))
    .filter(({ at }) => at < 3)
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
}

export const randomEmoji = (random = Math.random): Emoji =>
  ALL[Math.floor(random() * ALL.length)] ?? (ALL[0] as Emoji);
