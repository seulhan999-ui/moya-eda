// Стартовый каталог «Моя еда»: авторские простые рецепты вкусного и полезного питания.
// Количества — на указанное число порций, вес круп и бобовых — сухой, мяса и рыбы — сырой.
// Пищевая ценность не вписывается вручную: она считается по справочнику продуктов (USDA).

import type { DietMode, Equipment, MealType, Recipe, RecipeIngredient, Unit } from '../core/types';
import { INGREDIENTS } from './ingredients';

const UNIT = new Map(INGREDIENTS.map((i) => [i.id, i.unit]));

/** [продукт, количество] — единица берётся из справочника; [продукт] — «по вкусу». */
type Ing = [string, number?];

interface Spec {
  id: string;
  name: string;
  icon: string;
  servings?: number;
  modes: DietMode[];
  meals: MealType[];
  eq: Equipment[];
  time: [total: number, active: number];
  ing: Ing[];
  steps: string[];
  passive?: string;
  cheaper?: string;
}

function ing([id, amount]: Ing): RecipeIngredient {
  const unit = UNIT.get(id) as Unit | undefined;
  if (!unit) throw new Error(`Нет продукта в справочнике: ${id}`);
  return amount === undefined ? { ingredientId: id, amount: 0, unit, toTaste: true } : { ingredientId: id, amount, unit };
}

function make(s: Spec): Recipe {
  return {
    id: s.id,
    name: s.name,
    servings: s.servings ?? 1,
    ingredients: s.ing.map(ing),
    steps: s.steps,
    timeTotalMin: s.time[0],
    timeActiveMin: s.time[1],
    modes: s.modes,
    mealTypes: s.meals,
    equipment: s.eq,
    source: 'Каталог «Моя еда»',
    verified: true,
    icon: s.icon,
    passive: s.passive,
    cheaper: s.cheaper,
  };
}

const SPECS: Spec[] = [
  // ================= ЗАВТРАКИ =================
  {
    id: 'oat_pear_walnut', name: 'Овсянка с грушей и грецким орехом', icon: 'Bowl with spoon',
    modes: ['economy', 'tasty'], meals: ['breakfast'], eq: ['stove'], time: [10, 5],
    ing: [['oats', 50], ['milk', 150], ['pear', 120], ['walnuts', 10], ['cinnamon']],
    steps: ['Залейте хлопья молоком и варите 5 минут, помешивая.', 'Нарежьте грушу кубиками, орехи слегка поломайте.', 'Выложите грушу и орехи на кашу, посыпьте корицей.'],
  },
  {
    id: 'overnight_oats_berries', name: 'Ленивая овсянка с черникой в банке', icon: 'Blueberries',
    modes: ['no_cook', 'economy'], meals: ['breakfast'], eq: ['none'], time: [485, 5], passive: 'настаивается ночь в холодильнике',
    ing: [['oats', 50], ['kefir', 150], ['blueberries', 80], ['honey', 10]],
    steps: ['Смешайте в банке хлопья и кефир.', 'Сверху выложите чернику, закройте крышкой.', 'Оставьте в холодильнике на ночь, утром полейте мёдом.'],
  },
  {
    id: 'omelette_spinach', name: 'Омлет со шпинатом и сыром', icon: 'Cooking',
    modes: ['economy', 'tasty'], meals: ['breakfast'], eq: ['stove'], time: [10, 10],
    ing: [['egg', 2], ['milk', 30], ['spinach', 50], ['cheese_hard', 15], ['olive_oil', 5], ['salt']],
    steps: ['Взбейте яйца с молоком и щепоткой соли.', 'Обжарьте шпинат на масле 1 минуту.', 'Влейте яйца, посыпьте тёртым сыром, готовьте под крышкой 4–5 минут.'],
  },
  {
    id: 'syrniki_oven', name: 'Сырники из духовки', icon: 'Pancakes', servings: 2,
    modes: ['tasty', 'economy'], meals: ['breakfast'], eq: ['oven'], time: [30, 10], passive: '20 минут в духовке',
    ing: [['cottage', 300], ['egg', 1], ['flour', 40], ['honey', 15], ['raspberries', 100]],
    steps: ['Разомните творог с яйцом и мёдом, добавьте муку.', 'Сформируйте 8 сырников, выложите на бумагу для выпечки.', 'Запекайте 20 минут при 190 °C. Подавайте с малиной.'],
  },
  {
    id: 'yogurt_berries_seeds', name: 'Греческий йогурт с малиной и льном', icon: 'Blueberries',
    modes: ['no_cook', 'tasty'], meals: ['breakfast', 'snack'], eq: ['none'], time: [3, 3],
    ing: [['greek_yogurt', 150], ['raspberries', 80], ['flaxseed', 10], ['honey', 5]],
    steps: ['Выложите йогурт в миску.', 'Добавьте ягоды, посыпьте льном и полейте мёдом.'],
  },
  {
    id: 'toast_avocado_egg', name: 'Тост с авокадо и яйцом', icon: 'Avocado',
    modes: ['tasty'], meals: ['breakfast'], eq: ['stove'], time: [8, 8],
    ing: [['bread_ww', 60], ['avocado', 70], ['egg', 1], ['lemon', 5], ['salt'], ['pepper']],
    steps: ['Подсушите хлеб на сухой сковороде.', 'Разомните авокадо с лимонным соком и солью, намажьте на тост.', 'Сверху положите яйцо, сваренное или обжаренное без масла.'],
    cheaper: 'Дешевле: вместо авокадо — творог с зеленью.',
  },
  {
    id: 'buckwheat_milk', name: 'Гречневая каша с молоком', icon: 'Bowl with spoon',
    modes: ['economy'], meals: ['breakfast'], eq: ['stove'], time: [20, 5], passive: '15 минут каша варится сама',
    ing: [['buckwheat', 50], ['milk', 200], ['honey', 5]],
    steps: ['Промойте гречку, залейте 100 мл воды и варите под крышкой 12 минут.', 'Добавьте молоко, доведите до кипения.', 'Подавайте с мёдом.'],
  },
  {
    id: 'cottage_apple_cinnamon', name: 'Творог с яблоком, орехами и корицей', icon: 'Red apple',
    modes: ['no_cook', 'economy'], meals: ['breakfast', 'snack'], eq: ['none'], time: [5, 5],
    ing: [['cottage', 150], ['apple', 100], ['walnuts', 10], ['cinnamon']],
    steps: ['Натрите яблоко или нарежьте кубиками.', 'Смешайте с творогом, посыпьте орехами и корицей.'],
  },
  {
    id: 'mug_omelette', name: 'Омлет в кружке за 3 минуты', icon: 'Egg',
    modes: ['no_cook', 'economy'], meals: ['breakfast'], eq: ['microwave'], time: [4, 2],
    ing: [['egg', 2], ['milk', 30], ['tomato', 50], ['green_onion', 5], ['bread_rye', 30], ['salt']],
    steps: ['Взбейте яйца с молоком прямо в кружке.', 'Добавьте нарезанный помидор и лук.', 'Готовьте в микроволновке 90 секунд, перемешайте и ещё 30–40 секунд. Подавайте с ломтиком ржаного хлеба.'],
  },
  {
    id: 'rye_toast_cottage', name: 'Ржаной тост с творогом и огурцом', icon: 'Bread',
    modes: ['no_cook', 'economy'], meals: ['breakfast'], eq: ['none'], time: [5, 5],
    ing: [['bread_rye', 60], ['cottage', 80], ['cucumber', 60], ['dill', 3], ['salt']],
    steps: ['Смешайте творог с рубленым укропом и щепоткой соли.', 'Намажьте на хлеб, сверху — кружки огурца.'],
  },
  {
    id: 'oat_pancake', name: 'Овсяноблин с сыром и помидором', icon: 'Pancakes',
    modes: ['tasty', 'economy'], meals: ['breakfast'], eq: ['stove'], time: [12, 12],
    ing: [['oats', 40], ['egg', 2], ['milk', 30], ['cheese_hard', 20], ['tomato', 60], ['salt']],
    steps: ['Смешайте хлопья, яйца, молоко и соль, дайте постоять 3 минуты.', 'Вылейте на антипригарную сковороду и жарьте 3 минуты с каждой стороны.', 'Положите на половину сыр и помидор, сложите пополам.'],
  },
  {
    id: 'banana_peanut_toast', name: 'Тост с арахисовой пастой и бананом', icon: 'Banana',
    modes: ['no_cook'], meals: ['breakfast', 'snack'], eq: ['none'], time: [3, 3],
    ing: [['bread_ww', 60], ['peanut_butter', 15], ['banana', 100]],
    steps: ['Намажьте хлеб арахисовой пастой.', 'Выложите кружки банана.'],
  },
  {
    id: 'shakshuka_chickpea', name: 'Шакшука с нутом', icon: 'Shallow pan of food',
    modes: ['tasty'], meals: ['breakfast', 'dinner'], eq: ['stove'], time: [15, 10],
    ing: [['egg', 2], ['tomatoes_can', 200], ['chickpeas_can', 80], ['onion', 40], ['bell_pepper', 75], ['olive_oil', 5], ['paprika'], ['salt']],
    steps: ['Обжарьте лук и перец на масле 4 минуты.', 'Добавьте томаты, нут и паприку, тушите 5 минут.', 'Сделайте углубления, вбейте яйца и готовьте под крышкой 4–5 минут.'],
  },
  {
    id: 'kefir_smoothie', name: 'Смузи из кефира, банана и черники', icon: 'Glass of milk',
    modes: ['no_cook'], meals: ['breakfast', 'snack'], eq: ['blender'], time: [5, 5],
    ing: [['kefir', 200], ['banana', 100], ['blueberries', 50], ['oats', 15]],
    steps: ['Сложите всё в блендер.', 'Взбейте до однородности 30–40 секунд.'],
  },
  {
    id: 'eggs_veg_rye', name: 'Яйца с овощами и ржаным хлебом', icon: 'Egg',
    modes: ['economy'], meals: ['breakfast'], eq: ['stove'], time: [12, 3], passive: 'яйца варятся 9 минут',
    ing: [['egg', 2], ['cucumber', 100], ['tomato', 100], ['bread_rye', 40], ['salt']],
    steps: ['Сварите яйца вкрутую — 9 минут после закипания.', 'Нарежьте огурец и помидор.', 'Подавайте с хлебом.'],
  },

  // ================= ОБЕДЫ =================
  {
    id: 'bulgur_chicken_pepper', name: 'Булгур с курицей и печёным перцем', icon: 'Green salad',
    modes: ['tasty'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [20, 10],
    ing: [['bulgur', 70], ['chicken_breast', 150], ['bell_pepper', 150], ['greek_yogurt', 50], ['olive_oil', 5], ['parsley', 5], ['salt']],
    steps: ['Залейте булгур кипятком 1:2, накройте на 15 минут.', 'Нарежьте курицу и перец, обжарьте на масле 8 минут.', 'Смешайте с булгуром, добавьте йогурт и зелень.'],
    cheaper: 'Дешевле: вместо куриного филе — бедро без кожи.',
  },
  {
    id: 'pollock_rice_cucumber', name: 'Минтай с рисом и огурцом', icon: 'Fish',
    modes: ['economy'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [20, 10],
    ing: [['pollock', 180], ['rice', 60], ['cucumber', 100], ['lemon', 10], ['sunflower_oil', 5], ['dill', 3], ['salt']],
    steps: ['Сварите рис — 15 минут.', 'Обжарьте минтай на масле по 4 минуты с каждой стороны, сбрызните лимоном.', 'Подавайте с рисом, огурцом и укропом.'],
  },
  {
    id: 'warm_bean_salad', name: 'Тёплый салат с фасолью и яйцом', icon: 'Beans',
    modes: ['economy'], meals: ['lunch'], eq: ['stove'], time: [10, 10],
    ing: [['beans_red_can', 120], ['egg', 1], ['tomato', 100], ['onion', 20], ['parsley', 5], ['olive_oil', 10], ['salt']],
    steps: ['Сварите яйцо вкрутую.', 'Прогрейте фасоль на сковороде с луком 2 минуты.', 'Смешайте с помидором, яйцом, зеленью и маслом.'],
  },
  {
    id: 'lentil_soup', name: 'Суп из красной чечевицы', icon: 'Steaming bowl',
    modes: ['economy', 'tasty'], meals: ['lunch'], eq: ['stove'], time: [25, 10], passive: '15 минут суп варится сам',
    ing: [['lentils_red', 60], ['carrot', 60], ['onion', 40], ['tomato_paste', 15], ['sunflower_oil', 5], ['curry'], ['salt']],
    steps: ['Обжарьте лук и тёртую морковь на масле 3 минуты, добавьте пасту и карри.', 'Добавьте чечевицу и 400 мл воды, варите 15 минут.', 'Посолите и при желании пробейте блендером.'],
  },
  {
    id: 'green_soup', name: 'Зелёный суп-пюре из брокколи', icon: 'Broccoli',
    modes: ['tasty'], meals: ['lunch', 'dinner'], eq: ['stove', 'blender'], time: [25, 10],
    ing: [['broccoli', 150], ['spinach', 50], ['potato', 100], ['onion', 30], ['sour_cream', 20], ['sunflower_seeds', 10], ['salt']],
    passive: '15 минут суп варится сам',
    steps: ['Залейте картофель, лук и брокколи 400 мл воды, варите 15 минут.', 'Добавьте шпинат на 1 минуту.', 'Пробейте блендером, подавайте со сметаной и семечками.'],
  },
  {
    id: 'cabbage_chicken_stew', name: 'Тушёная капуста с курицей и картофелем', icon: 'Pot of food',
    modes: ['economy'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [35, 10], passive: '25 минут тушится сама',
    ing: [['cabbage', 250], ['chicken_thigh', 130], ['potato', 150], ['carrot', 50], ['onion', 30], ['tomato_paste', 15], ['sunflower_oil', 5], ['salt']],
    steps: ['Обжарьте курицу кусочками 5 минут.', 'Добавьте лук, морковь, кубики картофеля и нашинкованную капусту, влейте 100 мл воды.', 'Тушите под крышкой 25 минут, в конце добавьте пасту.'],
  },
  {
    id: 'buckwheat_mushroom_sour', name: 'Гречка с грибами в сметанном соусе', icon: 'Mushroom',
    modes: ['economy', 'tasty'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [25, 10],
    passive: 'гречка варится 15 минут',
    ing: [['buckwheat', 70], ['mushrooms', 150], ['onion', 40], ['sour_cream', 30], ['sunflower_oil', 5], ['dill', 3], ['salt']],
    steps: ['Сварите гречку — 15 минут.', 'Обжарьте лук и грибы 7 минут, добавьте сметану и 2 ложки воды.', 'Смешайте с гречкой, посыпьте укропом.'],
  },
  {
    id: 'pasta_tuna_tomato', name: 'Паста с тунцом и томатами', icon: 'Spaghetti',
    modes: ['tasty', 'economy'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [15, 8],
    ing: [['pasta_wg', 80], ['tuna_can', 80], ['tomatoes_can', 150], ['garlic', 5], ['olive_oil', 5], ['oregano'], ['salt']],
    steps: ['Отварите пасту по инструкции.', 'Прогрейте чеснок в масле, добавьте томаты и орегано, тушите 5 минут.', 'Добавьте тунец и пасту, перемешайте.'],
  },
  {
    id: 'lavash_chicken_wrap', name: 'Лаваш с курицей и овощами', icon: 'Burrito',
    modes: ['tasty'], meals: ['lunch'], eq: ['stove'], time: [15, 10],
    ing: [['lavash', 70], ['chicken_breast', 100], ['lettuce', 30], ['tomato', 80], ['cucumber', 60], ['greek_yogurt', 40], ['paprika'], ['salt']],
    steps: ['Обжарьте курицу полосками с паприкой 7 минут.', 'Смажьте лаваш йогуртом, выложите салат, овощи и курицу.', 'Плотно сверните.'],
  },
  {
    id: 'chickpea_feta_salad', name: 'Салат из нута с овощами и фетой', icon: 'Green salad',
    modes: ['no_cook', 'tasty'], meals: ['lunch'], eq: ['none'], time: [7, 7],
    ing: [['chickpeas_can', 120], ['cucumber', 100], ['tomato', 100], ['feta', 30], ['olive_oil', 10], ['lemon', 10], ['parsley', 5]],
    steps: ['Промойте нут.', 'Нарежьте овощи, раскрошите фету.', 'Смешайте всё, заправьте маслом и лимонным соком.'],
  },
  {
    id: 'tuna_bean_salad', name: 'Салат с тунцом и белой фасолью', icon: 'Canned food',
    modes: ['no_cook', 'economy'], meals: ['lunch', 'dinner'], eq: ['none'], time: [5, 5],
    ing: [['tuna_can', 80], ['beans_white_can', 120], ['green_onion', 10], ['lettuce', 40], ['olive_oil', 10], ['salt']],
    steps: ['Слейте жидкость с фасоли и тунца.', 'Смешайте с салатом и зелёным луком.', 'Заправьте маслом.'],
  },
  {
    id: 'bean_borscht', name: 'Борщ с фасолью', icon: 'Pot of food',
    modes: ['economy', 'tasty'], meals: ['lunch'], eq: ['stove'], time: [45, 15], passive: '30 минут варится сам',
    ing: [['beet', 100], ['cabbage', 100], ['potato', 80], ['carrot', 40], ['onion', 30], ['tomato_paste', 15], ['beans_red_can', 80], ['sour_cream', 15], ['sunflower_oil', 5], ['salt']],
    steps: ['Обжарьте лук, морковь и тёртую свёклу с пастой 5 минут.', 'Залейте 500 мл воды, добавьте картофель, варите 15 минут.', 'Добавьте капусту и фасоль, варите ещё 10 минут. Подавайте со сметаной.'],
  },
  {
    id: 'couscous_veg_feta', name: 'Кускус с овощами и фетой', icon: 'Cooked rice',
    modes: ['tasty'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [15, 10],
    ing: [['couscous', 60], ['zucchini', 120], ['bell_pepper', 75], ['feta', 30], ['olive_oil', 7], ['salt']],
    steps: ['Залейте кускус кипятком 1:1,5, накройте на 5 минут.', 'Обжарьте кабачок и перец 6 минут.', 'Смешайте, добавьте раскрошенную фету.'],
  },
  {
    id: 'liver_buckwheat', name: 'Куриная печень с луком и гречкой', icon: 'Poultry leg',
    modes: ['economy'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [25, 15],
    ing: [['chicken_liver', 150], ['onion', 50], ['buckwheat', 60], ['sour_cream', 20], ['sunflower_oil', 5], ['salt']],
    steps: ['Сварите гречку — 15 минут.', 'Обжарьте лук, добавьте печень и жарьте 6 минут.', 'Добавьте сметану, прогрейте 2 минуты. Подавайте с гречкой.'],
  },
  {
    id: 'turkey_meatballs_tomato', name: 'Тефтели из индейки в томате с макаронами', icon: 'Pot of food',
    modes: ['tasty'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [30, 15],
    passive: '20 минут тушатся сами',
    ing: [['turkey_mince', 130], ['rice', 20], ['onion', 30], ['tomatoes_can', 150], ['pasta_wg', 50], ['dill', 3], ['salt']],
    steps: ['Смешайте фарш, сырой рис, половину лука и соль, слепите тефтели.', 'Выложите в сковороду, залейте томатами с оставшимся луком и 100 мл воды.', 'Тушите под крышкой 20 минут. Подавайте с отваренными макаронами.'],
  },
  {
    id: 'barley_mushrooms', name: 'Перловка с грибами и морковью', icon: 'Mushroom',
    modes: ['economy'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [50, 10], passive: '40 минут перловка варится сама',
    ing: [['barley', 60], ['mushrooms', 150], ['onion', 40], ['carrot', 40], ['sunflower_oil', 7], ['salt']],
    steps: ['Сварите перловку — 40 минут.', 'Обжарьте лук, морковь и грибы 8 минут.', 'Смешайте с перловкой.'],
  },
  {
    id: 'baked_potato_cottage', name: 'Печёный картофель с творогом и зеленью', icon: 'Potato',
    modes: ['economy'], meals: ['lunch', 'dinner'], eq: ['oven'], time: [40, 10], passive: '30 минут в духовке',
    ing: [['potato', 250], ['cottage', 100], ['dill', 5], ['garlic', 3], ['olive_oil', 5], ['salt']],
    steps: ['Разрежьте картофель пополам, смажьте маслом, запекайте 30 минут при 200 °C.', 'Смешайте творог с зеленью, чесноком и солью.', 'Подавайте картофель с творожным соусом.'],
  },
  {
    id: 'salmon_couscous', name: 'Горбуша с кускусом и шпинатом', icon: 'Fish',
    modes: ['tasty'], meals: ['lunch', 'dinner'], eq: ['stove'], time: [20, 10],
    ing: [['pink_salmon', 150], ['couscous', 60], ['spinach', 50], ['lemon', 10], ['olive_oil', 5], ['salt']],
    steps: ['Запарьте кускус кипятком на 5 минут.', 'Обжарьте горбушу по 4 минуты с каждой стороны.', 'Прогрейте шпинат 1 минуту, подавайте всё вместе с лимоном.'],
  },
  {
    id: 'hummus_sandwich', name: 'Бутерброды с хумусом и овощами', icon: 'Sandwich',
    modes: ['no_cook'], meals: ['lunch', 'snack'], eq: ['none'], time: [5, 5],
    ing: [['bread_ww', 60], ['hummus', 40], ['tomato', 80], ['lettuce', 20]],
    steps: ['Намажьте хлеб хумусом.', 'Выложите лист салата и кружки помидора.'],
  },

  // ================= УЖИНЫ =================
  {
    id: 'buckwheat_chicken_veg', name: 'Гречка с курицей и овощами', icon: 'Cooked rice',
    modes: ['economy'], meals: ['dinner', 'lunch'], eq: ['stove'], time: [25, 10],
    passive: 'гречка варится 15 минут',
    ing: [['buckwheat', 60], ['chicken_thigh', 150], ['veg_mix_frozen', 150], ['soy_sauce', 10], ['sunflower_oil', 5]],
    steps: ['Сварите гречку — 15 минут.', 'Обжарьте курицу кусочками 6 минут, добавьте овощи ещё на 5 минут.', 'Смешайте с гречкой и соевым соусом.'],
  },
  {
    id: 'baked_pollock_veg', name: 'Минтай, запечённый с кабачком и картофелем', icon: 'Fish',
    modes: ['economy'], meals: ['dinner'], eq: ['oven'], time: [30, 10], passive: '20 минут в духовке',
    ing: [['pollock', 200], ['potato', 200], ['zucchini', 150], ['tomato', 100], ['cheese_hard', 15], ['olive_oil', 5], ['salt']],
    steps: ['Выложите в форму тонкие кружки картофеля и кабачка, сверху рыбу и помидоры.', 'Посолите, сбрызните маслом, посыпьте сыром.', 'Запекайте 20 минут при 200 °C.'],
  },
  {
    id: 'salmon_broccoli', name: 'Горбуша с брокколи, рисом и кунжутом', icon: 'Fish',
    modes: ['tasty'], meals: ['dinner'], eq: ['stove'], time: [20, 10], passive: 'рис варится 15 минут',
    ing: [['pink_salmon', 150], ['rice', 60], ['broccoli', 200], ['soy_sauce', 10], ['sesame', 3], ['lemon', 10]],
    steps: ['Сварите рис, брокколи приготовьте на пару или отварите 5 минут.', 'Обжарьте горбушу по 4 минуты, в конце полейте соевым соусом.', 'Подавайте с брокколи, посыпьте кунжутом.'],
  },
  {
    id: 'shrimp_rice_broccoli', name: 'Рис с креветками и брокколи', icon: 'Shrimp',
    modes: ['tasty'], meals: ['dinner'], eq: ['stove'], time: [20, 10],
    ing: [['shrimp', 150], ['rice', 60], ['broccoli', 150], ['garlic', 5], ['soy_sauce', 10], ['olive_oil', 5]],
    steps: ['Сварите рис.', 'Обжарьте чеснок, добавьте брокколи на 4 минуты, затем креветки на 3 минуты.', 'Смешайте с рисом и соевым соусом.'],
    cheaper: 'Дешевле: вместо креветок — минтай кусочками.',
  },
  {
    id: 'beef_veg_rice', name: 'Говяжий фарш с овощами и рисом', icon: 'Cut of meat',
    modes: ['tasty'], meals: ['dinner'], eq: ['stove'], time: [20, 10],
    ing: [['beef_mince', 120], ['veg_mix_frozen', 200], ['onion', 30], ['soy_sauce', 10], ['rice', 50]],
    steps: ['Сварите рис.', 'Обжарьте фарш с луком 6 минут, добавьте овощи ещё на 6 минут.', 'Заправьте соевым соусом, подавайте с рисом.'],
  },
  {
    id: 'turkey_zucchini_bake', name: 'Индейка с кабачком, картофелем и сыром', icon: 'Shallow pan of food',
    modes: ['tasty'], meals: ['dinner'], eq: ['oven'], time: [40, 10], passive: '30 минут в духовке',
    ing: [['turkey_mince', 130], ['potato', 200], ['zucchini', 150], ['tomato', 60], ['cheese_hard', 20], ['salt']],
    steps: ['Нарежьте картофель и кабачок тонкими кружками, выложите в форму.', 'Сверху — фарш, кружки помидора и тёртый сыр.', 'Запекайте 30 минут при 190 °C.'],
  },
  {
    id: 'veg_frittata', name: 'Фриттата с овощами', icon: 'Cooking',
    modes: ['economy'], meals: ['dinner', 'breakfast'], eq: ['stove'], time: [20, 10],
    ing: [['egg', 3], ['veg_mix_frozen', 150], ['cheese_hard', 20], ['milk', 50], ['olive_oil', 5], ['salt']],
    steps: ['Обжарьте овощи 5 минут.', 'Залейте яйцами, взбитыми с молоком, посыпьте сыром.', 'Готовьте под крышкой на слабом огне 10 минут.'],
  },
  {
    id: 'lentil_curry_spinach', name: 'Карри из чечевицы со шпинатом', icon: 'Steaming bowl',
    modes: ['tasty', 'economy'], meals: ['dinner', 'lunch'], eq: ['stove'], time: [25, 10],
    passive: '15 минут варится само',
    ing: [['lentils_red', 70], ['tomatoes_can', 150], ['spinach', 60], ['onion', 40], ['yogurt', 50], ['sunflower_oil', 5], ['curry'], ['salt']],
    steps: ['Обжарьте лук с карри 3 минуты.', 'Добавьте чечевицу, томаты и 250 мл воды, варите 15 минут.', 'Вмешайте шпинат, подавайте с йогуртом.'],
  },
  {
    id: 'cauliflower_cheese_bake', name: 'Цветная капуста, запечённая с сыром', icon: 'Broccoli',
    modes: ['economy'], meals: ['dinner'], eq: ['oven'], time: [30, 10], passive: '20 минут в духовке',
    ing: [['cauliflower', 250], ['egg', 1], ['milk', 50], ['cheese_hard', 25], ['salt']],
    steps: ['Отварите соцветия 4 минуты, выложите в форму.', 'Залейте яйцом, взбитым с молоком, посыпьте сыром.', 'Запекайте 20 минут при 200 °C.'],
  },
  {
    id: 'chicken_mushroom_sour', name: 'Куриное бедро с грибами в сметане и гречкой', icon: 'Poultry leg',
    modes: ['tasty', 'economy'], meals: ['dinner'], eq: ['stove'], time: [25, 10],
    passive: 'жарится и тушится, помешивать лишь изредка',
    ing: [['chicken_thigh', 150], ['mushrooms', 150], ['onion', 30], ['sour_cream', 30], ['buckwheat', 60], ['cucumber', 100], ['salt']],
    steps: ['Обжарьте курицу 6 минут, добавьте лук и грибы.', 'Через 7 минут добавьте сметану и 50 мл воды, тушите 5 минут.', 'Подавайте с гречкой и свежим огурцом.'],
  },
  {
    id: 'eggplant_chickpea_stew', name: 'Рагу из баклажана с нутом', icon: 'Eggplant',
    modes: ['tasty'], meals: ['dinner', 'lunch'], eq: ['stove'], time: [30, 10], passive: '20 минут тушится само',
    ing: [['eggplant', 200], ['chickpeas_can', 100], ['tomatoes_can', 150], ['onion', 30], ['garlic', 5], ['olive_oil', 10], ['salt']],
    steps: ['Обжарьте лук, чеснок и кубики баклажана 6 минут.', 'Добавьте томаты и нут.', 'Тушите под крышкой 20 минут.'],
  },
  {
    id: 'pumpkin_soup', name: 'Тыквенный суп-пюре с семечками', icon: 'Steaming bowl',
    modes: ['tasty'], meals: ['dinner', 'lunch'], eq: ['stove', 'blender'], time: [30, 10], passive: '20 минут варится сам',
    ing: [['pumpkin', 250], ['carrot', 50], ['onion', 30], ['milk', 100], ['sunflower_seeds', 10], ['olive_oil', 5], ['salt']],
    steps: ['Обжарьте лук на масле, добавьте тыкву, морковь и 300 мл воды.', 'Варите 20 минут, влейте молоко.', 'Пробейте блендером, посыпьте семечками.'],
  },
  {
    id: 'pollock_cutlets', name: 'Рыбные котлеты из минтая с гречкой', icon: 'Fish', servings: 2,
    modes: ['economy'], meals: ['dinner', 'lunch'], eq: ['stove'], time: [30, 20],
    ing: [['pollock', 400], ['onion', 50], ['egg', 1], ['oats', 30], ['buckwheat', 120], ['sunflower_oil', 10], ['salt']],
    steps: ['Измельчите рыбу с луком.', 'Добавьте яйцо, хлопья и соль, оставьте на 5 минут.', 'Сформируйте котлеты, жарьте по 4–5 минут с каждой стороны. Подавайте с гречкой.'],
  },
  {
    id: 'chicken_oven_salad', name: 'Куриное филе из духовки с булгуром и салатом', icon: 'Poultry leg',
    modes: ['economy', 'tasty'], meals: ['dinner', 'lunch'], eq: ['oven'], time: [30, 10], passive: '20 минут в духовке',
    ing: [['chicken_breast', 150], ['bulgur', 60], ['lettuce', 50], ['tomato', 100], ['cucumber', 100], ['olive_oil', 10], ['paprika'], ['salt']],
    steps: ['Натрите филе паприкой и солью, запекайте 20 минут при 200 °C.', 'Залейте булгур кипятком на 15 минут, нарежьте овощи и заправьте маслом.', 'Подавайте курицу с булгуром и салатом.'],
  },
  {
    id: 'cottage_casserole', name: 'Творожная запеканка с малиной', icon: 'Pancakes', servings: 2,
    modes: ['economy', 'tasty'], meals: ['dinner', 'breakfast'], eq: ['oven'], time: [40, 10], passive: '30 минут в духовке',
    ing: [['cottage', 400], ['egg', 2], ['oats', 40], ['honey', 15], ['raspberries', 100]],
    steps: ['Смешайте творог, яйца, хлопья и мёд.', 'Выложите в форму, сверху — малина.', 'Запекайте 30 минут при 180 °C.'],
  },
  {
    id: 'lazy_cabbage_rolls', name: 'Ленивые голубцы', icon: 'Pot of food',
    modes: ['economy'], meals: ['dinner'], eq: ['stove'], time: [40, 15], passive: '25 минут тушатся сами',
    ing: [['beef_mince', 120], ['cabbage', 150], ['rice', 30], ['onion', 30], ['tomatoes_can', 150], ['sour_cream', 15], ['salt']],
    steps: ['Нашинкуйте капусту, смешайте с фаршем, сырым рисом и луком.', 'Сформируйте котлеты, выложите в сковороду, залейте томатами и 100 мл воды.', 'Тушите под крышкой 25 минут. Подавайте со сметаной.'],
  },
  {
    id: 'vinaigrette_beans', name: 'Винегрет с фасолью', icon: 'Green salad',
    modes: ['economy'], meals: ['dinner', 'lunch'], eq: ['stove'], time: [40, 15], passive: 'овощи варятся 25 минут',
    ing: [['beet', 150], ['potato', 100], ['carrot', 60], ['pickles', 50], ['beans_red_can', 60], ['sauerkraut', 50], ['sunflower_oil', 10]],
    steps: ['Отварите свёклу, картофель и морковь в мундире.', 'Нарежьте овощи и солёные огурцы кубиками.', 'Смешайте с фасолью и капустой, заправьте маслом.'],
  },
  {
    id: 'microwave_veg_eggs', name: 'Овощи с яйцом в микроволновке', icon: 'Bento box',
    modes: ['no_cook', 'economy'], meals: ['dinner'], eq: ['microwave'], time: [7, 3],
    ing: [['veg_mix_frozen', 200], ['egg', 2], ['cheese_hard', 15], ['salt']],
    steps: ['Прогрейте овощи в микроволновке 3 минуты.', 'Залейте взбитыми яйцами, посыпьте сыром.', 'Готовьте ещё 2–3 минуты.'],
  },

  // ================= ПЕРЕКУСЫ И «ПОЧТИ БЕЗ ГОТОВКИ» =================
  {
    id: 'hummus_veg_sticks', name: 'Хумус с овощными палочками', icon: 'Carrot',
    modes: ['no_cook'], meals: ['snack'], eq: ['none'], time: [5, 5],
    ing: [['hummus', 60], ['carrot', 80], ['cucumber', 80], ['bell_pepper', 75]],
    steps: ['Нарежьте овощи палочками.', 'Подавайте с хумусом.'],
  },
  {
    id: 'apple_peanut', name: 'Яблоко с арахисовой пастой', icon: 'Green apple',
    modes: ['no_cook', 'economy'], meals: ['snack'], eq: ['none'], time: [2, 2],
    ing: [['apple', 180], ['peanut_butter', 15]],
    steps: ['Нарежьте яблоко дольками.', 'Подавайте с арахисовой пастой.'],
  },
  {
    id: 'kefir_raspberry_flax', name: 'Кефир с малиной и льном', icon: 'Glass of milk',
    modes: ['no_cook', 'economy'], meals: ['snack'], eq: ['none'], time: [2, 2],
    ing: [['kefir', 200], ['raspberries', 50], ['flaxseed', 5]],
    steps: ['Смешайте кефир с ягодами.', 'Посыпьте льном.'],
  },
  {
    id: 'cottage_blueberry_honey', name: 'Творог с черникой и мёдом', icon: 'Blueberries',
    modes: ['no_cook', 'economy'], meals: ['snack', 'breakfast'], eq: ['none'], time: [3, 3],
    ing: [['cottage', 150], ['blueberries', 70], ['honey', 5]],
    steps: ['Выложите творог, сверху ягоды.', 'Полейте мёдом.'],
  },
  {
    id: 'nuts_apricots', name: 'Горсть орехов с курагой', icon: 'Chestnut',
    modes: ['no_cook'], meals: ['snack'], eq: ['none'], time: [1, 1],
    ing: [['walnuts', 20], ['dried_apricots', 25]],
    steps: ['Отмерьте порцию — так проще не переесть.'],
  },
  {
    id: 'egg_cucumber_snack', name: 'Яйцо, огурец и ржаной хлеб', icon: 'Egg',
    modes: ['economy'], meals: ['snack'], eq: ['stove'], time: [10, 2], passive: 'яйцо варится 9 минут',
    ing: [['egg', 1], ['cucumber', 80], ['bread_rye', 25], ['salt']],
    steps: ['Сварите яйцо вкрутую.', 'Подавайте с огурцом и хлебом.'],
  },
  {
    id: 'mozzarella_tomato', name: 'Моцарелла с помидорами и орегано', icon: 'Cheese wedge',
    modes: ['no_cook', 'tasty'], meals: ['snack', 'lunch'], eq: ['none'], time: [4, 4],
    ing: [['mozzarella', 60], ['tomato', 150], ['olive_oil', 5], ['oregano'], ['salt']],
    steps: ['Нарежьте помидоры и моцареллу кружками.', 'Выложите внахлёст, сбрызните маслом, посыпьте орегано.'],
  },
  {
    id: 'tuna_lavash_roll', name: 'Ролл из лаваша с тунцом и огурцом', icon: 'Burrito',
    modes: ['no_cook'], meals: ['lunch', 'snack'], eq: ['none'], time: [5, 5],
    ing: [['lavash', 60], ['tuna_can', 70], ['cucumber', 60], ['greek_yogurt', 30], ['lettuce', 20]],
    steps: ['Смешайте тунец с йогуртом.', 'Выложите на лаваш с салатом и огурцом.', 'Сверните и разрежьте пополам.'],
  },
  {
    id: 'yogurt_orange_kiwi', name: 'Йогурт с апельсином и киви', icon: 'Kiwi fruit',
    modes: ['no_cook'], meals: ['snack', 'breakfast'], eq: ['none'], time: [4, 4],
    ing: [['yogurt', 150], ['orange', 100], ['kiwi', 75]],
    steps: ['Нарежьте фрукты.', 'Выложите на йогурт.'],
  },
  {
    id: 'pear_cheese', name: 'Груша с сыром и орехами', icon: 'Pear',
    modes: ['no_cook', 'tasty'], meals: ['snack'], eq: ['none'], time: [3, 3],
    ing: [['pear', 150], ['cheese_hard', 20], ['walnuts', 10]],
    steps: ['Нарежьте грушу и сыр ломтиками.', 'Подавайте с орехами.'],
  },
];

export const RECIPES: Recipe[] = SPECS.map(make);
