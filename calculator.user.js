// ==UserScript==
// @name            World of Dundeon Skill Calculator
// @namespace       ttang.tw
// @updateURL       https://raw.githubusercontent.com/xyzith/wod_skill_calculator/master/calculator.user.js
// @grant           none
// @author          Taylor Tang
// @version         1.1
// @description     Compute skill accuracy and damage.
// @match           http*://*.world-of-dungeons.org/*
// ==/UserScript==

(function(){
	var LANGUAGE = {
		detail: '详细描述',
		skill: '技能',
		fix: '修正',
		atk_type: '攻击类型',
		atk_method: '攻击方式',
		atk_bonus: '攻击奖励',
		skill_type: '技能类型',
		atk_rate: '攻击',
		atk_damage: '伤害',
		range_atk: '远程攻击',
		def_rate: '防御',
		def_bonus: '防御奖励',
		melee_atk: '近战攻击',
		piercing_damage: '穿刺伤害',
		train_cost: '训练费',
		damage_type: '伤害方式',
		damage_bonus: '伤害奖励',
		skill_lv_bouns: '对技能等级的奖励',
		effect_on_owner: '作用在技能拥有者上的效果',
		effect_on_target: '作用在被此技能影响的目标上的效果',
		skill_lv: '技能等级',
		hero_lv: '英雄等级 ',
		str: '力量',
		sta: '体质',
		int: '智力',
		dex: '灵巧',
		cha: '魅力',
		agi: '敏捷',
		per: '感知',
		wil: '意志',
		attr: '属性',
		value: '数值',
		cost: '所需花费',
		mapping: function(str) {
			for(var k in this) {
				if(this[k] === str) {
					return k;
				}
			}
			return str;
		}
	};

	function queryStrToJSON(str) {
		var query = str.replace(/^\?/, '').split('&');
		var json = {};
		query.forEach(function(v){
			v = v.split('=');
			json[v[0]] = v[1];
		});
		return json;
	}

	function xhr(url, callback) {
		var x = new XMLHttpRequest();
		x.open('GET', url);
		x.onload = function() {callback(x);};
		x.send();
	}

	function chomp(str) {
		return str.replace(/[ \xA0\n\t\r]*/g, '');
	}

	function findTable(doc, text) {
		var main_content = doc.getElementById('main_content') || doc.querySelector('.main_content');
		var tables = main_content.querySelectorAll('table.content_table');
		var res;
		Array.prototype.forEach.call(tables, function(v){
			var header = v.querySelector('.header');
			if(header && chomp(header.textContent) === text) {
				res = v;
			}
		});
		return res;
	}

	function getComputedValue(v) {
		var value = v.match(/^\d+$|\d+(?=\]$)/);
		if(value && (value = parseInt(value[0]))) {
			return value;
		}
		return 0;
	}

	function Hero(id) {
		this.id = id;
		this.level = 0;
		this.attr = {
			agi: 0,
			cha: 0,
			dex: 0,
			int: 0,
			per: 0,
			sta: 0,
			str: 0,
			wil: 0
		};
		this.skill = {};
		this.buff = [];
	}

	Hero.prototype.getAttr = function() {
		var hero = this;
		function parseRow(row) {
			var child = row.children;
			child = Array.prototype.map.call(child, function(c){
				return LANGUAGE.mapping(chomp(c.textContent));
			});
			var key = child[0];
			var value = child[1];
			value = getComputedValue(value);
			hero.attr[key] = value;
		}
		function getLevel(table) {
			var lv = table.rows[0].cells[1].textContent;
			return parseInt(lv);
		}
		var promise = new Promise( function(resolve, reject) {
			xhr('/wod/spiel/hero/attributes.php?is_pupup=1&session_hero_id=' + this.id, function(r){
				var parser = new DOMParser();
				var doc = parser.parseFromString(r.responseText, 'text/html');
				var table = findTable(doc, LANGUAGE.attr + LANGUAGE.value + LANGUAGE.cost);
				var rows = table.querySelectorAll('tr[class^="row"]');
				Array.prototype.forEach.call(rows, function(r){
					parseRow(r);
				});
				hero.level = getLevel(table.parentNode.nextElementSibling.nextElementSibling.querySelector('table'));
				resolve(hero.attr);
			});
		});
		return promise;
	};
	Hero.prototype.getSkill = function() {
		var hero = this;
		function parseRow(row) {
			var data = row.children;
			data = Array.prototype.map.call(data, function(d){
				return chomp(d.textContent);
			});
			var key = data[1];
			var value = data[2];
			hero.skill[key] = getComputedValue(value);
		}
		var promise = new Promise( function(resolve, reject) {
			xhr('wod/spiel/hero/skills.php?is_popup=1&session_hero_id=' + this.id, function(r){
				var parser = new DOMParser();
				var doc = parser.parseFromString(r.responseText, 'text/html');
				var table = findTable(doc, LANGUAGE.train_cost);
				var rows = table.querySelectorAll('tr[class^="row"]');
				Array.prototype.forEach.call(rows, function(r){
					parseRow(r);
				});
				resolve(hero.skill);
			});
		});
		return promise;
	};


	Hero.prototype.cast = function(skill) {
	//  apply buff => skill self buff => comupte
		function getComputedStat(hero, attr) {
			var main = hero.attr[attr.main];
			var sub =  hero.attr[attr.sub];
			return {
				main: main,
				sub: sub
			};
		}
		
		function computeAccuracy(attr) {
			if(!attr) { return null; }
			var stat = getComputedStat(hero, attr);
			return (sl + stat.main) * 2 + stat.sub;
		}

		function computeDamage(attr) {
			if(!attr) { return null; }
			var stat = getComputedStat(hero, attr);
			return (sl + stat.main) / 2 + stat.sub / 3;
		}

		function computeEffect(effects) {
			effects = effects.map(function(e) {
				var res = {};
				for(var k in e) {
					res[k] = e[k];
					if(typeof res[k].formula === 'function') {
						res[k].value = res[k].formula(hl, sl);
					}
				}
				return res;
			});
			return effects;
		}

		function computeAllEffects(cate) {
			var res = {};
			for(var k in cate) {
				if(cate.hasOwnProperty(k)) {
					res[k] = computeEffect(cate[k]);
				}
			}
			return res;
		}

		var hero = this;
		var hl = hero.level;
		var sl = hero.skill[skill.name] || 0; //TODO add buff fix
		var effect_on_owner = computeAllEffects(skill.effect_on_owner);
		var effect_on_target = computeAllEffects(skill.effect_on_owner);
		effect_on_owner = this.ignoreUnavaliableEffect(effect_on_owner);
		hero.buff.push(effect_on_owner);


		var atk_rate_buff = this.computeAccuracyBuff(skill, 'atk_bonus');
		var def_rate_buff = this.computeAccuracyBuff(skill, 'def_bonus');
		var atk_rate = computeAccuracy(skill.attr.atk_rate);
		var def_rate = computeAccuracy(skill.attr.def_rate);
		var atk_bonus = (skill.attr.atk_rate) ? skill.attr.atk_rate.bonus : 0;
		var def_bonus = (skill.attr.def_rate) ? skill.attr.def_rate.bonus : 0;
	//	var atk_damage = computeDamage(skill.attr.atk_damage);

		var atk_rate_final = ((atk_rate * atk_rate_buff.factor + atk_rate_buff.fix) * (100 + atk_bonus) / 100).toFixed(2);
		var def_rate_final = ((def_rate * def_rate_buff.factor + def_rate_buff.fix) * (100 + def_bonus) / 100).toFixed(2);
		console.log('LV ' + (this.skill[skill.name] || 0) + ' '+ skill.name);
		console.log('Accuracy: ' + atk_rate_final);
		console.log('Dodge: ' + def_rate_final);
	//	console.log('Damage: ' + atk_damage);
		return ['LV ' + (this.skill[skill.name] || 0) + ' '+ skill.name, 'Accuracy: ' + atk_rate_final, 'Dodge: ' + def_rate_final]
	};

	Hero.prototype.computeAccuracyBuff = function(skill, type) {
		var buffs = this.buff;
		var fix = 0;
		var factor = 1;
		var handler = {
			def_bonus: function(e, skill) {
				return {
					fix: e.fix.value.fix,
					factor: e.fix.value.factor
				};
				
			},
			atk_bonus: function(e, skill) {
				var r = {fix: 0, factor: 0};
				if(e.atk_method === skill.atk_type) {
					r.fix = e.fix.value.fix;
					r.factor = e.fix.value.factor;
				}
				return r;
			}
		};
		buffs.forEach(function(buff) {
			if(buff[type]) {
				buff[type].forEach(function(e){
					var inc = handler[type](e, skill);
					fix = fix + inc.fix;
					factor = factor * (inc.factor + 1);
				});
			}
		});
		return {
			fix: fix,
			factor: factor
		};
	};

	Hero.prototype.ignoreUnavaliableEffect = function(effects) {
		// TODO
		return effects;
	};

	function Skill(name, doc) {
		this.attr = {};
		this.name = name;
		this.page =  doc;
		this.effect_on_owner = {};
		this.effect_on_target = {};
		this.getSkillInfo();
		this.getEffect();
	}
	Skill.prototype.getSkillInfo = function() {
		var skill = this;
		function parseRow(r) {
			var title = chomp(r.querySelector('th').textContent);
			switch(title) {
				case LANGUAGE.atk_type:
					var content = chomp(r.querySelector('td').textContent);
					content = LANGUAGE.mapping(content);
					skill.atk_type = content;
					break;
				case LANGUAGE.skill_type:
					var content = chomp(r.querySelector('td').textContent);
					content = LANGUAGE.mapping(content);
					skill.skill_type = content;
					break;
				case LANGUAGE.atk_rate:
					skill.attr.atk_rate = parseAttr(r);
					break;
				case LANGUAGE.atk_damage:
					skill.attr.atk_damage = parseAttr(r);
					break;
				case LANGUAGE.def_rate:
					skill.attr.def_rate = parseAttr(r);
					break;
			}
		}
		function parseAttr(r) {
			function parseBouns(dom) {
				var bonus = dom.querySelector('span.bonus');
				if(bonus) {
					bonus = parseInt(bonus.textContent.replace(/[\(\)]/g, ''));
					bonus = isNaN(bonus) ? 0 : bonus;
					return bonus;
				}
				return 0;
			}
			function removeBonusSpan(dom) {
				var clone = dom.cloneNode(true);
				var bonus = clone.querySelector('span.bonus');
				if(bonus) {
					clone.removeChild(bonus);
				}
				return clone;
			}

			var attrs, damage_type;
			var content = r.querySelector('td');
			var bonus = parseBouns(content);
			content = removeBonusSpan(content);
			content = chomp(content.innerHTML);
			content = content.split('<br>');
			attrs = content[0].split(',');
			attrs = attrs.map(LANGUAGE.mapping.bind(LANGUAGE));
			
			var res =  {
				main: attrs[0],
				sub: attrs[1],
				bonus: bonus
			};

			if(content[1]) {
				res.damage_type = LANGUAGE.mapping(content[1]);
			}
			return res;
		}
		function parseContent(c) {
			var tr = c.getElementsByTagName('tr');
			Array.prototype.forEach.call(tr, parseRow);
		}
		
		var table = findTable(this.page, LANGUAGE.skill + LANGUAGE.detail);
		if(table) {
			parseContent(table.querySelector('.row0').children[1]);
		}
	};

	Skill.prototype.getEffect = function() {
		function getSection(page, tag) {
			function recRead(cursor, title_tag, list) {
				var section = document.createElement('div');
				title_tag = title_tag.toUpperCase();
				list = list || [];
				if(!cursor) {
					return list;
				}
				do {
					section.appendChild(cursor.cloneNode(true));
					cursor = cursor.nextSibling;
				} while(cursor && cursor.tagName != title_tag);

				list.push(section);
				if(cursor) {
					return recRead(cursor, title_tag, list);
				} else {
					return list;
				}
			}
			var start_cursor = page.querySelector(tag);
			return recRead(start_cursor, tag);
		}
		function parseSection(sec) {
			function parseSubsection(sub, target) {
				var effect_parser = new EffectParser();
				function parseHeaderCell(cell) {
					var text;
					text = cell.textContent.replace(/\([arz]\)/, '');
					text = LANGUAGE.mapping(chomp(text));
					return text;
				}
				function parseTable(table) {
					var key_mapping = [];
					var header = table.rows[0];
					var rows = table.querySelectorAll('tr[class^="row"]');
					for(var i = 0; i < header.cells.length; i++) {
						key_mapping.push(parseHeaderCell(header.cells[i]));
					}

					var effects = Array.prototype.map.call(rows, function(row) {
						var res = {};
						for(var i = 0; i < row.children.length; i++) {
							//res[key_mapping[i]] = row.children[i];
							res[key_mapping[i]] = row.children[i].textContent;
						}
						return res;
					});
					return effects.map(effect_parser.parse.bind(effect_parser));

				}
				var bonus_type = sub.querySelector('h3').textContent;
				var table = sub.querySelector('table');
				if(table) {
					target[LANGUAGE.mapping(bonus_type)] = parseTable(table);
				}
			}
			var target = LANGUAGE.mapping(sec.querySelector('h2').textContent);
			var sub_sections = getSection(sec, 'h3');
			sub_sections.forEach(function(sub){
				parseSubsection(sub, skill[target]);
			});
		}
		var skill = this;
		var sections = getSection(this.page, 'h2');
		sections.forEach(parseSection);
	};

	function EffectParser() {
		this.handler = {
			fix: this.parseFormula.bind(this)
		};
	}

	EffectParser.prototype.parse = function(data) {
		for(var k in data) {
			if(!this.handler[k]) {
				data[k] = this.parseDefault(data[k]);
			} else {
				data[k] = this.handler[k](data[k]);
			}
		}
		return data;
	};
	EffectParser.prototype.getApplyType = function(str) {
		var reg = /\(([arz])\)/;
		var apply_type = str.match(reg);
		var result = { text: str };
		if(apply_type) {
			result.apply_type = apply_type[1];
			result.text = result.text.replace(reg, '');
		}
		return result;
	};

	EffectParser.prototype.parseDefault = function(str) {
		str = this.getApplyType(str).text;
		return chomp(str);
	};

	EffectParser.prototype.parseFormula = function(str) {
		var data = this.getApplyType(chomp(str));
		return {
			formula: new EffectFormula(data.text),
			apply_type: data.apply_type
		};
	};

	function EffectFormula(string) {
		this.bonus = 0;
		this.factor = 0;
		this.sl_factor = 0;
		this.hl_factor = 0;
		this.string = string;
		this.parseFormula();
		return this.formula.bind(this);
	}

	EffectFormula.prototype.parseFormula = function(){
		function parseToken(token) {
			var res = {
				prefix: token.substring(0, 1),
				text: token.substring(1)
			};
			return res;
		}
		function buildFormula(tokens) {
			function parseTarget(token){
				var target;
				if(token && !/\d/.test(token.text)) {
					target = LANGUAGE.mapping(token.text);
					if(target === 'skill_lv') {
						return 'sl_factor';
					} else if(target === 'hero_lv') {
						return 'hl_factor';
					} else {
						console.error('Formula parse error :' + token.text);
					}
				}
				return 'factor';
			}

			var token, match, target;
			for(var i = 0; i < tokens.length; i++) {
				token = tokens[i];
				match = token.text.match(/(\d+)%$/);
				if(match) {
					factor = parseInt(token.prefix + match[1]) / 100;
					if(tokens[i + 1] && tokens[i + 1].prefix === '\xD7') {
						target = parseTarget(tokens[i + 1]);
						i++;
					}  else {
						target = 'factor';
					}
				} else if(/^\d+$/.test(token.text)){
					factor = parseInt(token.prefix + token.text);
					target = 'bonus';
				} else {
					factor = 1;
					target = parseTarget(tokens[i]);
				}
				formula[target] = factor;
			}
		}
		var formula = this;
		var str = this.string;
		var tokens = str.match(/((?:\xD7|\+|-)[^\xD7+-]+)/g);
		tokens = tokens.map(parseToken);
		buildFormula(tokens);
	};

	EffectFormula.prototype.formula = function(hl, sl) {
		var res = {
			fix: hl * this.hl_factor + sl * this.sl_factor + this.bonus,
			factor: this.factor
		};
		return res;
	};

	function UI() {
		var start_btn = document.createElement('div');
		start_btn.className = 'skill_calculator btn';
		start_btn.textContent = '+';
		this.start_btn = start_btn;

		var main = document.createElement('div')
		main.className = 'skill_calculator main';
		this.main = main;

		var search = queryStrToJSON(window.location.search);
		this.main_hero = new Hero(search.session_hero_id);
		this.skill = new Skill(decodeURIComponent(search.name), document);
		this.buff_hero = new Hero(); 

		this.addStyleRule(
			'.skill_calculator.btn { display: flex; justify-content: center; align-items: center; width: 20px; height: 20px; border: 1px solid rgba(0, 0, 0, 0.5); cursor: pointer; border-radius: 50%; }' +
			'.skill_calculator.main { padding: 10px; display: none; }' +
			'.skill_calculator { position: fixed; background: rgba(255, 255, 255, 0.5); color: #000000; bottom: 0px; right:0px; }'
		);
		function buildPanel() {
			this.start_btn.style.display = 'none';
			this.main.style.display = 'block';
			this.getHeroInfo().then(this.render.bind(this));
		}

		document.body.appendChild(this.start_btn);
		document.body.appendChild(this.main);
		start_btn.addEventListener('click', buildPanel.bind(this));
	}

	UI.prototype.addStyleRule = function(str) {
		var style = document.createElement('style');
		style.innerHTML = str;
		document.head.appendChild(style);
	};

	UI.prototype.init = function() {
		var ui = this;
	};

	UI.prototype.getHeroInfo = function() {
		return promise = Promise.all([this.main_hero.getAttr(), this.main_hero.getSkill()]);
	};

	UI.prototype.render = function(hero, skill) {
		var ui = this;
		console.log(this.main_hero);
		console.log(this.skill);
		
		this.main_hero.cast(this.skill).forEach(function(txt){
			ui.main.appendChild(ui.addText(txt));
		});
	};

	UI.prototype.addText = function(str) {
		var div = document.createElement('div');
		div.className = 'text';
		div.textContent = str;
		return div;
	};
	
	if(/skill\.php$/.test(window.location.pathname)) {
		new UI();
	}
})();
