#include <cctype>
#include <algorithm>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include <execinfo.h>
#include <limits.h>

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

#ifdef LYX_MATHD_USE_LYX_MATHED
#include <config.h>
#include "InsetMath.h"
#include "InsetMathHull.h"
#include "InsetMathNest.h"
#include "MathData.h"
#include "MathFactory.h"
#include "MathParser.h"
#include "MathStream.h"
#include "MathSupport.h"
#include "Buffer.h"
#include "BufferParams.h"
#include "BufferView.h"
#include "Color.h"
#include "CoordCache.h"
#include "Cursor.h"
#include "Dimension.h"
#include "DocIterator.h"
#include "Font.h"
#include "FontInfo.h"
#include "FuncCode.h"
#include "FuncRequest.h"
#include "CiteEnginesList.h"
#include "Encoding.h"
#include "LayoutFile.h"
#include "Language.h"
#include "LyX.h"
#include "MetricsInfo.h"
#include "ModuleList.h"
#include "frontends/Application.h"
#include "frontends/CaretGeometry.h"
#include "frontends/InputMethod.h"
#include "frontends/Painter.h"
#ifdef LYX_MATHD_USE_QT_FRONTEND
#include "frontends/qt/GuiPainter.h"
#endif
#include "MacroTable.h"
#include "support/docstream.h"
#include "support/docstring.h"
#include "support/debug.h"
#include "support/filetools.h"
#include "support/Package.h"
#include "texstream.h"

#ifdef LYX_MATHD_USE_QT_FRONTEND
#include <QBuffer>
#include <QByteArray>
#include <QImage>
#include <QIODevice>
#include <QPainter>
#include <QPainterPath>
#include <QPen>
#include <QtGlobal>
#else
#include <QCoreApplication>
#endif
#endif

namespace {

#ifdef LYX_MATHD_USE_LYX_MATHED
void trace(char const * message);
void crashTrace(int signal);

std::string defaultUserSupportDir()
{
	return {};
}

std::string executablePath()
{
#ifdef __APPLE__
	uint32_t size = PATH_MAX;
	std::vector<char> path(size);
	if (_NSGetExecutablePath(path.data(), &size) != 0) {
		path.assign(size + 1, '\0');
		if (_NSGetExecutablePath(path.data(), &size) != 0)
			return "lyx-mathd";
	}
	char resolved[PATH_MAX];
	if (realpath(path.data(), resolved))
		return resolved;
	return path.data();
#else
	return "lyx-mathd";
#endif
}

#ifndef LYX_MATHD_USE_QT_FRONTEND
void ensureQtApplication()
{
	static std::unique_ptr<QCoreApplication> app;
	if (QCoreApplication::instance())
		return;
	static int argc = 1;
	static char arg0[] = "lyx-mathd";
	static char * argv[] = {arg0, nullptr};
	app = std::make_unique<QCoreApplication>(argc, argv);
}
#else
void ensureQtApplication()
{
	static lyx::frontend::Application * app = nullptr;
	if (app)
		return;
	if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
		qputenv("QT_QPA_PLATFORM", QByteArray("offscreen"));
	static int argc = 1;
	static char arg0[] = "lyx-mathd";
	static char * argv[] = {arg0, nullptr};
	app = lyx::createApplication(argc, argv);
	if (!app)
		throw std::runtime_error("could not create LyX Qt frontend application");
}
#endif

void ensureLyxCoreSingleton()
{
	static std::unique_ptr<lyx::LyX> lyx_core;
	if (!lyx_core)
		lyx_core = std::make_unique<lyx::LyX>();
}

void initializeLyxMathed()
{
	static bool initialized = false;
	if (!initialized) {
		trace("initialize: set lyxerr");
		lyx::lyxerr.setStream(std::cerr);
		trace("initialize: set use_gui");
#ifdef LYX_MATHD_USE_QT_FRONTEND
		lyx::use_gui = true;
#else
		lyx::use_gui = false;
#endif
		trace("initialize: lyx core singleton");
		ensureLyxCoreSingleton();
		trace("initialize: init_package");
		char const * bundled_support = std::getenv("LYX_MATHD_SYSTEM_SUPPORT_DIR");
		std::string const support_dir = bundled_support && *bundled_support
			? bundled_support : LYX_MATHD_SYSTEM_SUPPORT_DIR;
		lyx::support::init_package(executablePath(), support_dir, defaultUserSupportDir());
		trace("initialize: qt application");
		ensureQtApplication();
		trace("initialize: create temp dir");
		lyx::support::FileName const temp_dir = lyx::support::createLyXTmpDir(lyx::support::FileName());
		if (temp_dir.empty())
			throw std::runtime_error("could not create LyX temporary directory");
		lyx::support::package().set_temp_dir(temp_dir);
		trace("initialize: read encodings");
		lyx::support::FileName const symbols_path = lyx::support::libFileSearch(std::string(), "unicodesymbols");
		lyx::support::FileName const enc_path = lyx::support::libFileSearch(std::string(), "encodings");
		if (!symbols_path.empty() && !enc_path.empty())
			lyx::encodings.read(enc_path, symbols_path);
		trace("initialize: read languages");
		lyx::support::FileName const lang_path = lyx::support::libFileSearch(std::string(), "languages");
		if (!lang_path.empty())
			lyx::languages.read(lang_path);
		trace("initialize: read layouts");
		lyx::LayoutFileList::get().read();
		trace("initialize: init math");
		lyx::initMath();
		trace("initialize: done");
		initialized = true;
	}
}
#endif

struct Json {
	enum class Type { Null, Bool, Number, String, Array, Object };
	using Array = std::vector<Json>;
	using Object = std::map<std::string, Json>;

	Type type = Type::Null;
	std::variant<std::nullptr_t, bool, double, std::string, Array, Object> value = nullptr;

	static Json null() { return Json(); }
	static Json boolean(bool v) { Json j; j.type = Type::Bool; j.value = v; return j; }
	static Json number(double v) { Json j; j.type = Type::Number; j.value = v; return j; }
	static Json string(std::string v) { Json j; j.type = Type::String; j.value = std::move(v); return j; }
	static Json array(Array v) { Json j; j.type = Type::Array; j.value = std::move(v); return j; }
	static Json object(Object v) { Json j; j.type = Type::Object; j.value = std::move(v); return j; }

	bool isObject() const { return type == Type::Object; }
	Object const & asObject() const
	{
		if (type != Type::Object)
			throw std::runtime_error("expected object");
		return std::get<Object>(value);
	}
	std::string const & asString() const
	{
		if (type != Type::String)
			throw std::runtime_error("expected string");
		return std::get<std::string>(value);
	}
	bool asBool(bool fallback = false) const
	{
		if (type == Type::Null)
			return fallback;
		if (type != Type::Bool)
			throw std::runtime_error("expected boolean");
		return std::get<bool>(value);
	}
	double asNumber(double fallback = 0) const
	{
		if (type == Type::Null)
			return fallback;
		if (type != Type::Number)
			throw std::runtime_error("expected number");
		return std::get<double>(value);
	}
};

class Parser {
public:
	explicit Parser(std::string s) : s_(std::move(s)) {}
	Json parse()
	{
		Json v = value();
		ws();
		if (p_ != s_.size())
			throw std::runtime_error("trailing JSON");
		return v;
	}

private:
	Json value()
	{
		ws();
		if (p_ >= s_.size())
			throw std::runtime_error("unexpected end");
		char c = s_[p_];
		if (c == '"') return Json::string(string());
		if (c == '{') return object();
		if (c == '[') return array();
		if (c == 't') return literal("true", Json::boolean(true));
		if (c == 'f') return literal("false", Json::boolean(false));
		if (c == 'n') return literal("null", Json::null());
		if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) return number();
		throw std::runtime_error("bad JSON value");
	}

	Json literal(char const * text, Json v)
	{
		std::string t(text);
		if (s_.compare(p_, t.size(), t) != 0)
			throw std::runtime_error("bad literal");
		p_ += t.size();
		return v;
	}

	std::string string()
	{
		expect('"');
		std::string out;
		while (p_ < s_.size()) {
			char c = s_[p_++];
			if (c == '"')
				return out;
			if (c != '\\') {
				out.push_back(c);
				continue;
			}
			if (p_ >= s_.size())
				throw std::runtime_error("bad escape");
			char e = s_[p_++];
			switch (e) {
			case '"': out.push_back('"'); break;
			case '\\': out.push_back('\\'); break;
			case '/': out.push_back('/'); break;
			case 'b': out.push_back('\b'); break;
			case 'f': out.push_back('\f'); break;
			case 'n': out.push_back('\n'); break;
			case 'r': out.push_back('\r'); break;
			case 't': out.push_back('\t'); break;
			case 'u':
				out += "\\u";
				for (int i = 0; i < 4; ++i) {
					if (p_ >= s_.size()) throw std::runtime_error("short unicode escape");
					out.push_back(s_[p_++]);
				}
				break;
			default:
				throw std::runtime_error("bad escape");
			}
		}
		throw std::runtime_error("unterminated string");
	}

	Json number()
	{
		size_t b = p_;
		if (s_[p_] == '-') ++p_;
		while (p_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[p_]))) ++p_;
		if (p_ < s_.size() && s_[p_] == '.') {
			++p_;
			while (p_ < s_.size() && std::isdigit(static_cast<unsigned char>(s_[p_]))) ++p_;
		}
		return Json::number(std::stod(s_.substr(b, p_ - b)));
	}

	Json array()
	{
		expect('[');
		Json::Array a;
		ws();
		if (take(']')) return Json::array(std::move(a));
		while (true) {
			a.push_back(value());
			ws();
			if (take(']')) break;
			expect(',');
		}
		return Json::array(std::move(a));
	}

	Json object()
	{
		expect('{');
		Json::Object o;
		ws();
		if (take('}')) return Json::object(std::move(o));
		while (true) {
			ws();
			std::string k = string();
			ws();
			expect(':');
			o.emplace(std::move(k), value());
			ws();
			if (take('}')) break;
			expect(',');
		}
		return Json::object(std::move(o));
	}

	void ws()
	{
		while (p_ < s_.size() && std::isspace(static_cast<unsigned char>(s_[p_]))) ++p_;
	}
	bool take(char c)
	{
		if (p_ < s_.size() && s_[p_] == c) {
			++p_;
			return true;
		}
		return false;
	}
	void expect(char c)
	{
		if (!take(c))
			throw std::runtime_error(std::string("expected ") + c);
	}

	std::string s_;
	size_t p_ = 0;
};

std::string esc(std::string const & s)
{
	std::string out;
	for (char c : s) {
		switch (c) {
		case '"': out += "\\\""; break;
		case '\\': out += "\\\\"; break;
		case '\n': out += "\\n"; break;
		case '\r': out += "\\r"; break;
		case '\t': out += "\\t"; break;
		default:
			if (static_cast<unsigned char>(c) < 0x20) {
				char b[7];
				std::snprintf(b, sizeof(b), "\\u%04x", c);
				out += b;
			} else out.push_back(c);
		}
	}
	return out;
}

std::string dump(Json const & j);

std::string dump(Json::Object const & o)
{
	std::string out = "{";
	bool first = true;
	for (auto const & [k, v] : o) {
		if (!first) out += ",";
		first = false;
		out += "\"" + esc(k) + "\":" + dump(v);
	}
	return out + "}";
}

std::string dump(Json::Array const & a)
{
	std::string out = "[";
	for (size_t i = 0; i < a.size(); ++i) {
		if (i) out += ",";
		out += dump(a[i]);
	}
	return out + "]";
}

std::string dump(Json const & j)
{
	switch (j.type) {
	case Json::Type::Null: return "null";
	case Json::Type::Bool: return std::get<bool>(j.value) ? "true" : "false";
	case Json::Type::Number: {
		std::ostringstream os;
		os << std::get<double>(j.value);
		return os.str();
	}
	case Json::Type::String: return "\"" + esc(std::get<std::string>(j.value)) + "\"";
	case Json::Type::Array: return dump(std::get<Json::Array>(j.value));
	case Json::Type::Object: return dump(std::get<Json::Object>(j.value));
	}
	return "null";
}

Json const * find(Json::Object const & o, std::string const & k)
{
	auto it = o.find(k);
	return it == o.end() ? nullptr : &it->second;
}

Json const & get(Json::Object const & o, std::string const & k)
{
	Json const * v = find(o, k);
	if (!v) throw std::runtime_error("missing field: " + k);
	return *v;
}

std::string str(Json::Object const & o, std::string const & k, std::string fallback = "")
{
	Json const * v = find(o, k);
	return v ? v->asString() : fallback;
}

bool boolean(Json::Object const & o, std::string const & k, bool fallback = false)
{
	Json const * v = find(o, k);
	return v ? v->asBool(fallback) : fallback;
}

int integer(Json::Object const & o, std::string const & k, int fallback = 0)
{
	Json const * v = find(o, k);
	return v ? static_cast<int>(v->asNumber(fallback)) : fallback;
}

void trace(char const * message)
{
	if (std::getenv("LYX_MATHD_TRACE"))
		std::cerr << "[lyx-mathd] " << message << std::endl;
}

void crashTrace(int signal)
{
	void * stack[64];
	int const frames = backtrace(stack, 64);
	std::cerr << "[lyx-mathd] fatal signal " << signal << "\n";
	backtrace_symbols_fd(stack, frames, fileno(stderr));
	std::_Exit(128 + signal);
}

std::string htmlEscape(std::string const & s)
{
	std::string out;
	for (char c : s) {
		if (c == '&') out += "&amp;";
		else if (c == '<') out += "&lt;";
		else if (c == '>') out += "&gt;";
		else if (c == '"') out += "&quot;";
		else out.push_back(c);
	}
	return out;
}

#ifdef LYX_MATHD_USE_LYX_MATHED
struct FormulaView {
	std::string latex;
	bool display = false;
};

bool escapedAt(std::string const & s, size_t pos)
{
	size_t n = 0;
	while (pos > n && s[pos - n - 1] == '\\')
		++n;
	return n % 2 == 1;
}

bool commandAt(std::string const & s, size_t pos, char const * name)
{
	if (pos >= s.size() || s[pos] != '\\' || escapedAt(s, pos))
		return false;
	std::string command(name);
	if (s.compare(pos + 1, command.size(), command) != 0)
		return false;
	size_t const end = pos + 1 + command.size();
	return end >= s.size() || !std::isalpha(static_cast<unsigned char>(s[end]));
}

bool hasUnescapedDollar(std::string const & source)
{
	for (size_t i = 0; i < source.size(); ++i) {
		if (source[i] == '$' && !escapedAt(source, i))
			return true;
	}
	return false;
}

bool allowedMathEnvironment(std::string const & name)
{
	static std::vector<std::string> const names = {
		"array", "cases", "aligned", "alignedat", "gathered", "split",
		"subarray", "tabular", "matrix", "smallmatrix", "pmatrix",
		"bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "math", "equation",
		"equation*", "displaymath", "eqnarray", "eqnarray*", "align",
		"align*", "flalign", "flalign*", "alignat", "alignat*",
		"xalignat", "xalignat*", "xxalignat", "multline", "multline*",
		"gather", "gather*"
	};
	return std::find(names.begin(), names.end(), name) != names.end();
}

bool readEnvironmentCommand(std::string const & source, size_t pos,
                            std::string const & command,
                            std::string & name, size_t & next)
{
	if (!commandAt(source, pos, command.c_str()))
		return false;
	size_t p = pos + 1 + command.size();
	while (p < source.size() && std::isspace(static_cast<unsigned char>(source[p])))
		++p;
	if (p >= source.size() || source[p] != '{')
		throw std::runtime_error("malformed \\" + command + " command");
	size_t close = p + 1;
	while (close < source.size()) {
		if (source[close] == '}' && !escapedAt(source, close))
			break;
		++close;
	}
	if (close >= source.size())
		throw std::runtime_error("unterminated \\" + command + " environment name");
	name = source.substr(p + 1, close - p - 1);
	next = close + 1;
	return true;
}

FormulaView formulaView(std::string const & source, bool display)
{
	if (source.rfind("$$", 0) == 0) {
		std::string latex = source.substr(2);
		if (latex.size() >= 2 && latex.compare(latex.size() - 2, 2, "$$") == 0)
			latex.erase(latex.size() - 2);
		return {latex, true};
	}
	if (!source.empty() && source[0] == '$') {
		std::string latex = source.substr(1);
		if (!latex.empty() && latex.back() == '$' && !escapedAt(latex, latex.size() - 1))
			latex.pop_back();
		return {latex, false};
	}
	return {source, display};
}

std::string unsafeLyxParseReason(std::string const & source)
{
	if (source.empty())
		return {};
	if (hasUnescapedDollar(source))
		return "math delimiters are not part of the formula body";
	if (source.back() == '\\')
		return "incomplete trailing backslash";

	int brace_depth = 0;
	for (size_t i = 0; i < source.size(); ++i) {
		if (source[i] == '{' && !escapedAt(source, i)) {
			++brace_depth;
		} else if (source[i] == '}' && !escapedAt(source, i)) {
			if (brace_depth == 0)
				return "unmatched closing brace";
			--brace_depth;
		}
	}

	int left_depth = 0;
	std::vector<std::string> environment_stack;
	for (size_t i = 0; i < source.size(); ++i) {
		try {
			std::string env;
			size_t next = i;
			if (readEnvironmentCommand(source, i, "begin", env, next)) {
				if (!allowedMathEnvironment(env))
					return "unsupported math environment: " + env;
				environment_stack.push_back(env);
				i = next - 1;
				continue;
			}
			if (readEnvironmentCommand(source, i, "end", env, next)) {
				if (!allowedMathEnvironment(env))
					return "unsupported math environment: " + env;
				if (environment_stack.empty())
					return "unmatched \\end{" + env + "}";
				if (environment_stack.back() != env)
					return "\\end{" + env + "} does not match \\begin{"
						+ environment_stack.back() + "}";
				environment_stack.pop_back();
				i = next - 1;
				continue;
			}
		} catch (std::exception const & ex) {
			return ex.what();
		}
		if (commandAt(source, i, "left"))
			++left_depth;
		else if (commandAt(source, i, "right")) {
			if (left_depth == 0)
				return "unmatched \\right";
			--left_depth;
		}
	}
	if (!environment_stack.empty())
		return "unclosed \\begin{" + environment_stack.back() + "}";

	return {};
}

std::string mathMLFor(lyx::MathData const & math, bool display)
{
	lyx::odocstringstream os;
	lyx::MathMLStream ms(os, "", lyx::MathMLVersion::mathml3);
	std::string const attr = std::string("xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"")
		+ (display ? "block" : "inline") + "\"";
	ms << lyx::MTag("math", attr);
	ms << math;
	ms << lyx::ETag("math");
	return lyx::to_utf8(os.str());
}

std::string mathMLShell(std::string const & body, bool display)
{
	return std::string("<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"")
		+ (display ? "block" : "inline") + "\">" + body + "</math>";
}

using SymbolMap = std::map<std::string, std::pair<std::string, std::string>>;

SymbolMap const & mathSymbols()
{
	static SymbolMap const symbols = {
		{"alpha", {"mi", "&#x03B1;"}},
		{"beta", {"mi", "&#x03B2;"}},
		{"gamma", {"mi", "&#x03B3;"}},
		{"delta", {"mi", "&#x03B4;"}},
		{"epsilon", {"mi", "&#x03F5;"}},
		{"varepsilon", {"mi", "&#x03B5;"}},
		{"zeta", {"mi", "&#x03B6;"}},
		{"eta", {"mi", "&#x03B7;"}},
		{"theta", {"mi", "&#x03B8;"}},
		{"vartheta", {"mi", "&#x03D1;"}},
		{"iota", {"mi", "&#x03B9;"}},
		{"kappa", {"mi", "&#x03BA;"}},
		{"lambda", {"mi", "&#x03BB;"}},
		{"mu", {"mi", "&#x03BC;"}},
		{"nu", {"mi", "&#x03BD;"}},
		{"xi", {"mi", "&#x03BE;"}},
		{"pi", {"mi", "&#x03C0;"}},
		{"varpi", {"mi", "&#x03D6;"}},
		{"rho", {"mi", "&#x03C1;"}},
		{"varrho", {"mi", "&#x03F1;"}},
		{"sigma", {"mi", "&#x03C3;"}},
		{"varsigma", {"mi", "&#x03C2;"}},
		{"tau", {"mi", "&#x03C4;"}},
		{"upsilon", {"mi", "&#x03C5;"}},
		{"phi", {"mi", "&#x03D5;"}},
		{"varphi", {"mi", "&#x03C6;"}},
		{"chi", {"mi", "&#x03C7;"}},
		{"psi", {"mi", "&#x03C8;"}},
		{"omega", {"mi", "&#x03C9;"}},
		{"Gamma", {"mi", "&#x0393;"}},
		{"Delta", {"mi", "&#x0394;"}},
		{"Theta", {"mi", "&#x0398;"}},
		{"Lambda", {"mi", "&#x039B;"}},
		{"Xi", {"mi", "&#x039E;"}},
		{"Pi", {"mi", "&#x03A0;"}},
		{"Sigma", {"mi", "&#x03A3;"}},
		{"Upsilon", {"mi", "&#x03A5;"}},
		{"Phi", {"mi", "&#x03A6;"}},
		{"Psi", {"mi", "&#x03A8;"}},
		{"Omega", {"mi", "&#x03A9;"}},
		{"sum", {"mo", "&#x2211;"}},
		{"prod", {"mo", "&#x220F;"}},
		{"int", {"mo", "&#x222B;"}},
		{"infty", {"mo", "&#x221E;"}},
		{"pm", {"mo", "&#x00B1;"}},
		{"times", {"mo", "&#x00D7;"}},
		{"cdot", {"mo", "&#x22C5;"}},
		{"leq", {"mo", "&#x2264;"}},
		{"geq", {"mo", "&#x2265;"}},
		{"neq", {"mo", "&#x2260;"}}
	};
	return symbols;
}

std::string symbolTokenMathML(std::string const & name)
{
	auto const it = mathSymbols().find(name);
	if (it == mathSymbols().end())
		return {};
	std::string const & tag = it->second.first;
	std::string const & text = it->second.second;
	return "<" + tag + ">" + text + "</" + tag + ">";
}

std::string simpleLatexMathML(std::string const & latex, bool display)
{
	if (latex.empty())
		return {};
	std::string body;
	size_t tokens = 0;
	for (size_t i = 0; i < latex.size();) {
		unsigned char const c = static_cast<unsigned char>(latex[i]);
		if (std::isspace(c)) {
			++i;
			continue;
		}
		if (latex[i] == '\\') {
			size_t j = i + 1;
			while (j < latex.size() && std::isalpha(static_cast<unsigned char>(latex[j])))
				++j;
			if (j == i + 1)
				return {};
			std::string token = symbolTokenMathML(latex.substr(i + 1, j - i - 1));
			if (token.empty())
				return {};
			body += token;
			i = j;
			++tokens;
			continue;
		}
		if (std::isalpha(c)) {
			body += "<mi>";
			body += htmlEscape(std::string(1, latex[i]));
			body += "</mi>";
			++i;
			++tokens;
			continue;
		}
		if (std::isdigit(c)) {
			size_t j = i + 1;
			while (j < latex.size() && std::isdigit(static_cast<unsigned char>(latex[j])))
				++j;
			body += "<mn>" + htmlEscape(latex.substr(i, j - i)) + "</mn>";
			i = j;
			++tokens;
			continue;
		}
		if (std::string("+-=*/(),[]").find(latex[i]) != std::string::npos) {
			body += "<mo>" + htmlEscape(std::string(1, latex[i])) + "</mo>";
			++i;
			++tokens;
			continue;
		}
		return {};
	}
	if (body.empty())
		return {};
	if (tokens > 1)
		body = "<mrow>" + body + "</mrow>";
	return mathMLShell(body, display);
}

struct PainterOp {
	std::string type;
	int x1 = 0;
	int y1 = 0;
	int x2 = 0;
	int y2 = 0;
	int w = 0;
	int h = 0;
	std::string text;
};

class HeadlessInputMethod : public lyx::frontend::InputMethod {
public:
	lyx::docstring & preeditString() const override { return preedit_; }
	lyx::pos_type & segmentStart(lyx::size_type) const override { return zero_pos_; }
	lyx::size_type & segmentLength(lyx::size_type) const override { return zero_size_; }
	lyx::size_type segmentSize() const override { return 0; }
	lyx::pos_type charFormatIndex(lyx::pos_type) const override { return 0; }
	void setParagraphMetrics(lyx::ParagraphMetrics &) override {}
	int horizontalAdvance(lyx::docstring const & s, lyx::pos_type const) override
	{
		return static_cast<int>(s.size()) * 8;
	}
	bool canWrapAnywhere(lyx::pos_type const) override { return false; }
	void toggleInputMethodAcceptance() override {}
	void enableInputMethod() override {}
	void disableInputMethod() override {}
#ifdef Q_DEBUG
	void setHint(Hint) override {}
#endif

private:
	mutable lyx::docstring preedit_;
	mutable lyx::pos_type zero_pos_ = 0;
	mutable lyx::size_type zero_size_ = 0;
};

class RecordingPainter : public lyx::frontend::Painter {
public:
	RecordingPainter() : Painter(1, false) {}

	void line(int x1, int y1, int x2, int y2, lyx::Color,
	          line_style = line_solid, int = thin_line) override
	{
		ops_.push_back({"line", x1, y1, x2, y2});
	}

	void lines(int const * xp, int const * yp, int np, lyx::Color,
	           fill_style = fill_none, line_style = line_solid,
	           int = thin_line) override
	{
		for (int i = 1; i < np; ++i)
			line(xp[i - 1], yp[i - 1], xp[i], yp[i], lyx::Color());
	}

	void path(int const * xp, int const * yp,
	          int const *, int const *, int const *, int const *,
	          int np, lyx::Color,
	          fill_style = fill_none, line_style = line_solid,
	          int = thin_line) override
	{
		if (np > 0)
			ops_.push_back({"path", xp[0], yp[0], np ? xp[np - 1] : xp[0], np ? yp[np - 1] : yp[0]});
	}

	void rectangle(int x, int y, int w, int h, lyx::Color,
	               line_style = line_solid, int = thin_line) override
	{
		ops_.push_back({"rect", x, y, 0, 0, w, h});
	}

	void fillRectangle(int x, int y, int w, int h, lyx::Color) override
	{
		ops_.push_back({"fillRect", x, y, 0, 0, w, h});
	}

	void arc(int x, int y, unsigned int w, unsigned int h,
	         int, int, lyx::Color) override
	{
		ops_.push_back({"arc", x, y, 0, 0, static_cast<int>(w), static_cast<int>(h)});
	}

	void ellipse(double x, double y, double rx, double ry, lyx::Color,
	             fill_style = fill_none, line_style = line_solid,
	             int = thin_line) override
	{
		ops_.push_back({"ellipse", static_cast<int>(x), static_cast<int>(y), 0, 0,
			static_cast<int>(rx), static_cast<int>(ry)});
	}

	void point(int x, int y, lyx::Color) override
	{
		ops_.push_back({"point", x, y});
	}

	void image(int x, int y, int w, int h,
	           lyx::graphics::Image const &, bool const = false) override
	{
		ops_.push_back({"image", x, y, 0, 0, w, h});
	}

	void text(int x, int y, lyx::docstring const & str, lyx::FontInfo const &,
	          Direction const = Auto) override
	{
		ops_.push_back({"text", x, y, 0, 0, 0, 0, lyx::to_utf8(str)});
	}

	void text(int x, int y, lyx::char_type c, lyx::FontInfo const &,
	          Direction const = Auto) override
	{
		ops_.push_back({"text", x, y, 0, 0, 0, 0, lyx::to_utf8(lyx::docstring(1, c))});
	}

	void text(int x, int y, lyx::docstring const & str, lyx::Font const &,
	          double, double) override
	{
		ops_.push_back({"text", x, y, 0, 0, 0, 0, lyx::to_utf8(str)});
	}

	void text(int x, int y, lyx::docstring const & str, lyx::Font const &,
	          lyx::Color, lyx::size_type, lyx::size_type,
	          double, double) override
	{
		ops_.push_back({"text", x, y, 0, 0, 0, 0, lyx::to_utf8(str)});
	}

	void text(int, int, lyx::char_type, lyx::frontend::InputMethod const *,
	          lyx::pos_type const, lyx::FontInfo const * = nullptr,
	          Direction const = Auto) override {}

	void text(int x, int y, lyx::docstring const & str,
	          lyx::frontend::InputMethod const *, lyx::pos_type const,
	          lyx::FontInfo const * = nullptr, Direction const = Auto) override
	{
		ops_.push_back({"text", x, y, 0, 0, 0, 0, lyx::to_utf8(str)});
	}

	bool isNull() const override { return false; }

	void textDecoration(lyx::FontInfo const &, int x, int y, int width) override
	{
		ops_.push_back({"line", x, y, x + width, y});
	}

	void rectText(int x, int baseline, lyx::docstring const & str,
	              lyx::FontInfo const &, lyx::Color, lyx::Color) override
	{
		ops_.push_back({"text", x, baseline, 0, 0, 0, 0, lyx::to_utf8(str)});
	}

	void buttonText(int x, int baseline, lyx::docstring const & s,
	                lyx::FontInfo const &, lyx::Color, lyx::Color, int) override
	{
		ops_.push_back({"text", x, baseline, 0, 0, 0, 0, lyx::to_utf8(s)});
	}

	void enterMonochromeMode(lyx::Color const &) override {}
	void leaveMonochromeMode() override {}

	void wavyHorizontalLine(lyx::FontInfo const &, int x, int y,
	                        int width, lyx::ColorCode) override
	{
		ops_.push_back({"line", x, y, x + width, y});
	}

	std::vector<PainterOp> const & ops() const { return ops_; }

private:
	std::vector<PainterOp> ops_;
};

Json painterOpsJson(std::vector<PainterOp> const & ops)
{
	Json::Array out;
	for (PainterOp const & op : ops) {
		Json::Object o = {
			{"type", Json::string(op.type)},
			{"x1", Json::number(op.x1)},
			{"y1", Json::number(op.y1)}
		};
		if (op.x2 || op.y2) {
			o["x2"] = Json::number(op.x2);
			o["y2"] = Json::number(op.y2);
		}
		if (op.w || op.h) {
			o["w"] = Json::number(op.w);
			o["h"] = Json::number(op.h);
		}
		if (!op.text.empty())
			o["text"] = Json::string(op.text);
		out.push_back(Json::object(std::move(o)));
	}
	return Json::array(std::move(out));
}

std::string painterSvg(std::vector<PainterOp> const & ops, lyx::Dimension const & dim)
{
	int const width = std::max(1, dim.width() + 8);
	int const height = std::max(1, dim.height() + 8);
	std::string svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\""
		+ std::to_string(width) + "\" height=\"" + std::to_string(height)
		+ "\" viewBox=\"0 0 " + std::to_string(width) + " " + std::to_string(height)
		+ "\">";
	for (PainterOp const & op : ops) {
		if (op.type == "text") {
			svg += "<text x=\"" + std::to_string(op.x1 + 4) + "\" y=\""
				+ std::to_string(op.y1 + 4) + "\" font-size=\"12\" "
				+ "font-family=\"serif\" fill=\"currentColor\">"
				+ htmlEscape(op.text) + "</text>";
		} else if (op.type == "line") {
			svg += "<line x1=\"" + std::to_string(op.x1 + 4) + "\" y1=\""
				+ std::to_string(op.y1 + 4) + "\" x2=\"" + std::to_string(op.x2 + 4)
				+ "\" y2=\"" + std::to_string(op.y2 + 4)
				+ "\" stroke=\"currentColor\" stroke-width=\"1\"/>";
		} else if (op.type == "cursor") {
			svg += "<line x1=\"" + std::to_string(op.x1 + 4) + "\" y1=\""
				+ std::to_string(op.y1 + 4) + "\" x2=\"" + std::to_string(op.x1 + 4)
				+ "\" y2=\"" + std::to_string(op.y1 + op.h + 4)
				+ "\" stroke=\"currentColor\" stroke-width=\"1.5\"/>";
		} else if (op.type == "rect" || op.type == "fillRect") {
			svg += "<rect x=\"" + std::to_string(op.x1 + 4) + "\" y=\""
				+ std::to_string(op.y1 + 4) + "\" width=\"" + std::to_string(op.w)
				+ "\" height=\"" + std::to_string(op.h)
				+ (op.type == "fillRect"
					? "\" fill=\"currentColor\" opacity=\"0.2\"/>"
					: "\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/>");
		}
	}
	svg += "</svg>";
	return svg;
}

#ifdef LYX_MATHD_USE_QT_FRONTEND
std::string pngDataUri(QImage const & image)
{
	QByteArray bytes;
	QBuffer buffer(&bytes);
	buffer.open(QIODevice::WriteOnly);
	image.save(&buffer, "PNG");
	return std::string("data:image/png;base64,") + bytes.toBase64().toStdString();
}

void drawNativeCursorOps(QImage & image, std::vector<PainterOp> const & ops,
                         int render_scale)
{
	QPainter painter(&image);
	painter.setRenderHint(QPainter::Antialiasing, true);
	painter.scale(render_scale, render_scale);
	QPen pen(Qt::black);
	pen.setWidthF(1.25);
	painter.setPen(pen);
	for (PainterOp const & op : ops) {
		if (op.type != "cursor")
			continue;
		painter.drawLine(op.x1, op.y1, op.x1, op.y1 + op.h);
	}
}
#endif

struct HeadlessLyxView {
	HeadlessLyxView()
		: buffer("lyx-mathd-headless.lyx", true)
	{
		trace("HeadlessLyxView: Buffer constructed");
		buffer.setInternal(true);
		trace("HeadlessLyxView: makeDocumentClass");
		buffer.params().makeDocumentClass(false, true);
		trace("HeadlessLyxView: BufferView");
		view = std::make_unique<lyx::BufferView>(buffer);
		view->setInputMethod(&input_method);
		trace("HeadlessLyxView: ready");
	}

	lyx::Buffer buffer;
	HeadlessInputMethod input_method;
	std::unique_ptr<lyx::BufferView> view;
};

HeadlessLyxView & headlessLyxView()
{
	static HeadlessLyxView * ctx = new HeadlessLyxView();
	return *ctx;
}
#endif

struct Session {
	std::string id;
	std::string source;
	bool display = false;
	size_t cursor = 0;
#ifdef LYX_MATHD_USE_LYX_MATHED
	std::unique_ptr<lyx::MathData> math;
	lyx::InsetMathHull * hull = nullptr;
	lyx::CursorData cursor_data;
	bool lyxParsed = false;
	std::string lyxParseError;
#endif
};

#ifdef LYX_MATHD_USE_LYX_MATHED
std::string latexFor(lyx::MathData const & math)
{
	lyx::odocstringstream os;
	lyx::otexrowstream ots(os);
	lyx::TeXMathStream ts(ots, false, false, lyx::TeXMathStream::wsDefault);
	ts << math;
	return lyx::to_utf8(os.str());
}

std::string latexFor(lyx::InsetMathHull const & hull)
{
	lyx::odocstringstream os;
	lyx::otexrowstream ots(os);
	lyx::TeXMathStream ts(ots, false, false, lyx::TeXMathStream::wsDefault);
	hull.writeMath(ts);
	return lyx::to_utf8(os.str());
}

std::string trimAscii(std::string s)
{
	size_t begin = 0;
	while (begin < s.size() && std::isspace(static_cast<unsigned char>(s[begin])))
		++begin;
	size_t end = s.size();
	while (end > begin && std::isspace(static_cast<unsigned char>(s[end - 1])))
		--end;
	return s.substr(begin, end - begin);
}

lyx::MathData const * sessionMathData(Session const & s)
{
	if (s.hull)
		return &s.hull->cell(0);
	return s.math.get();
}

std::string sessionHullName(Session const & s)
{
	if (!s.hull)
		return {};
	return lyx::to_ascii(lyx::hullName(s.hull->getType()));
}

bool hullIsDisplay(lyx::InsetMathHull const * hull, bool fallback)
{
	if (!hull)
		return fallback;
	return hull->getType() != lyx::hullSimple;
}

std::string formulaSourceFromNative(Session const & s)
{
	if (s.hull) {
		lyx::HullType const type = s.hull->getType();
		if (type == lyx::hullSimple || type == lyx::hullEquation)
			return latexFor(s.hull->cell(0));
		return trimAscii(latexFor(*s.hull));
	}
	if (s.math)
		return latexFor(*s.math);
	return s.source;
}

lyx::Cursor cursorFor(Session const & s)
{
	HeadlessLyxView & ctx = headlessLyxView();
	lyx::Cursor cur(*ctx.view);
	cur.setCursorData(s.cursor_data);
	return cur;
}

bool cursorContainsSessionHull(Session const & s, lyx::Cursor const & cur)
{
	if (!s.hull || cur.empty())
		return false;
	for (size_t i = 0; i < cur.depth(); ++i) {
		if (&cur[i].inset() == s.hull)
			return true;
	}
	return false;
}

void saveCursor(Session & s, lyx::Cursor const & cur)
{
	s.cursor_data = cur;
	s.cursor_data.resetAnchor();
}

void createSessionHull(Session & s)
{
	HeadlessLyxView & ctx = headlessLyxView();
	lyx::Cursor cur(*ctx.view);
	cur.reset();
	cur.pit() = 0;
	cur.pos() = cur.lastpos();

	lyx::HullType const hull_type = s.display ? lyx::hullEquation : lyx::hullSimple;
	auto * hull = new lyx::InsetMathHull(&ctx.buffer, hull_type);
	cur.insert(hull);
	if (cur.pos() > 0)
		cur.posBackward();
	cur.push(*hull);
	hull->idxFirst(cur);
	s.hull = hull;
	saveCursor(s, cur);
}

void resetCursorToEnd(Session & s)
{
	if (!s.hull)
		return;
	lyx::Cursor cur = cursorFor(s);
	while (cur.depth() > 2)
		cur.pop();
	if (cur.depth() < 2) {
		createSessionHull(s);
		cur = cursorFor(s);
	}
	cur.idx() = 0;
	cur.pit() = 0;
	cur.pos() = static_cast<lyx::pos_type>(s.hull->cell(0).size());
	saveCursor(s, cur);
}

class ReadonlyGuard {
public:
	explicit ReadonlyGuard(lyx::Buffer * buffer)
		: buffer_(buffer), was_readonly_(buffer ? buffer->hasReadonlyFlag() : false)
	{
		if (buffer_)
			buffer_->setReadonly(true);
	}
	~ReadonlyGuard()
	{
		if (buffer_)
			buffer_->setReadonly(was_readonly_);
	}

private:
	lyx::Buffer * buffer_;
	bool was_readonly_;
};

lyx::InsetMathNest * currentMathNest(lyx::Cursor & cur)
{
	if (cur.empty() || !cur.inMathed())
		return nullptr;
	lyx::InsetMath * math = cur.inset().asInsetMath();
	return math ? math->asNestInset() : nullptr;
}

void selfInsertThroughMathNest(lyx::Cursor & cur, std::string const & text)
{
	ReadonlyGuard readonly(cur.buffer());
	lyx::docstring const input = lyx::from_utf8(text);
	if (lyx::InsetMathNest * nest = currentMathNest(cur)) {
		if (input.size() != 1 && nest->interpretString(cur, input))
			return;
	}
	for (lyx::char_type c : input) {
		lyx::InsetMathNest * nest = currentMathNest(cur);
		if (!nest)
			break;
		if (c == ' ' && cur.inMacroMode() && cur.macroName() != lyx::from_ascii("\\")
		    && cur.macroModeClose() && cur.pos() > 0) {
			cur.editInsertedInset();
			continue;
		}
		if (!nest->interpretChar(cur, c))
			break;
	}
}

bool mathCursorLocalPosition(lyx::Cursor const & cur, int & x, int & y)
{
	if (cur.empty() || !cur.inMathed())
		return false;
	lyx::Inset const & inset = cur.inset();
	if (!cur.bv().coordCache().insets().has(&inset))
		return false;
	inset.cursorPos(cur.bv(), cur.top(), cur.boundary(), x, y);
	lyx::Point const origin = cur.bv().coordCache().insets().xy(&inset);
	x += origin.x;
	y += origin.y;
	return true;
}

bool dispatchLyxMathLfun(Session const & s, lyx::Cursor & cur, lyx::FuncCode code,
                         lyx::docstring const & argument = lyx::docstring())
{
	lyx::Cursor before = cur;
	ReadonlyGuard readonly(cur.buffer());
	lyx::InsetMathNest * nest = currentMathNest(cur);
	if (!nest)
		return false;
	HeadlessLyxView & ctx = headlessLyxView();
	ctx.view->cursor() = cur;
	cur.saveBeforeDispatchPosXY();
	if (code == lyx::LFUN_UP || code == lyx::LFUN_DOWN) {
		int x = 0;
		int y = 0;
		if (mathCursorLocalPosition(cur, x, y))
			cur.setTargetX(x);
	}
	cur.dispatched();
	lyx::FuncRequest cmd(code, argument);
	nest->dispatch(cur, cmd);
	if (!cursorContainsSessionHull(s, cur)) {
		cur = before;
		return false;
	}
	return cur.result().dispatched();
}

bool insertNamedMathInset(Session const & s, lyx::Cursor & cur, lyx::docstring const & name)
{
	lyx::Cursor before = cur;
	ReadonlyGuard readonly(cur.buffer());
	if (!currentMathNest(cur))
		return false;
	HeadlessLyxView & ctx = headlessLyxView();
	ctx.view->cursor() = cur;
	cur.saveBeforeDispatchPosXY();
	cur.dispatched();
	cur.niceInsert(lyx::createInsetMath(name, cur.buffer()));
	if (!cursorContainsSessionHull(s, cur)) {
		cur = before;
		return false;
	}
	return true;
}

int boundedStructureSize(Json::Object const & o, std::string const & key, int fallback = 2)
{
	return std::clamp(integer(o, key, fallback), 1, 12);
}

std::string matrixDecoration(Json::Object const & o)
{
	std::string const decoration = str(o, "decoration", "pmatrix");
	static std::vector<std::string> const names = {
		"pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
		"smallmatrix", "matrix"
	};
	return std::find(names.begin(), names.end(), decoration) != names.end()
		? decoration : "matrix";
}

std::string matrixAlignment(Json::Object const & o, int cols)
{
	std::string align = str(o, "align");
	if (align.empty())
		align = std::string(static_cast<size_t>(cols), 'c');
	for (char & c : align) {
		if (c != 'l' && c != 'c' && c != 'r')
			c = 'c';
	}
	if (static_cast<int>(align.size()) < cols)
		align += std::string(static_cast<size_t>(cols - align.size()), 'c');
	if (static_cast<int>(align.size()) > cols)
		align.resize(static_cast<size_t>(cols));
	return align;
}

void appendCursorPainterOp(Session const & s, lyx::BufferView & bv,
                           std::vector<PainterOp> & ops)
{
	if (!s.hull)
		return;
	lyx::Cursor cur = cursorFor(s);
	if (!cursorContainsSessionHull(s, cur) || cur.empty() || !cur.inMathed())
		return;
	lyx::Inset const & inset = cur.inset();
	if (!bv.coordCache().insets().has(&inset))
		return;
	int x = 0;
	int y = 0;
	inset.cursorPos(bv, cur.top(), cur.boundary(), x, y);
	lyx::Point const origin = bv.coordCache().insets().xy(&inset);
	int ascent = 14;
	int height = 18;
	if (bv.coordCache().cells().has(&cur.cell())) {
		lyx::Dimension const dim = bv.coordCache().cells().dim(&cur.cell());
		ascent = dim.ascent();
		height = dim.height();
	}
	ops.push_back({"cursor", origin.x + x, origin.y + y - ascent, 0, 0, 1, height});
}
#endif

class Engine {
public:
	Engine()
	{
#ifdef LYX_MATHD_USE_LYX_MATHED
		initializeLyxMathed();
#endif
	}

	Json ping() const
	{
		return Json::object({
			{"name", Json::string("lyx-mathd")},
			{"version", Json::string("0.1.1")},
			{"engine", Json::string(engineName())},
			{"lyxMathed", Json::boolean(lyxMathed())}
		});
	}

		Json create(Json::Object const & p)
		{
			Session s;
			s.id = "s" + std::to_string(next_++);
			s.source = str(p, "source");
			s.display = boolean(p, "display");
			s.cursor = s.source.size();
			refreshMath(s);
		std::string const id = s.id;
		sessions_.emplace(id, std::move(s));
		return snapshot(sessions_[id]);
	}

		Json set(Json::Object const & p)
		{
			Session & s = session(str(p, "session"));
			s.source = str(p, "source");
			s.display = boolean(p, "display", s.display);
		s.cursor = s.source.size();
		refreshMath(s);
		return snapshot(s);
	}

	Json dispatch(Json::Object const & p)
	{
		Session & s = session(str(p, "session"));
		Json::Object const & a = get(p, "action").asObject();
		std::string t = str(a, "type");
#ifdef LYX_MATHD_USE_LYX_MATHED
		if (s.hull && s.lyxParsed) {
			lyx::Cursor cur = cursorFor(s);
			if (!cursorContainsSessionHull(s, cur)) {
				refreshMath(s);
				cur = cursorFor(s);
			}
			if (!cursorContainsSessionHull(s, cur))
				throw std::runtime_error("LyX cursor is not inside the session math hull");
			if (t == "insertText" || t == "insertChar") {
				std::string const text = t == "insertText" ? str(a, "text") : str(a, "char");
				selfInsertThroughMathNest(cur, text);
			} else if (t == "pasteLatex") {
				selfInsertThroughMathNest(cur, str(a, "text"));
			} else if (t == "backspace") {
				ReadonlyGuard readonly(cur.buffer());
				cur.backspace(true);
			} else if (t == "delete") {
				ReadonlyGuard readonly(cur.buffer());
				cur.erase(true);
			} else if (t == "moveBackward") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_CHAR_BACKWARD);
			} else if (t == "moveForward") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_CHAR_FORWARD);
			} else if (t == "moveUp") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_UP);
			} else if (t == "moveDown") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_DOWN);
			} else if (t == "cellForward") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_CELL_FORWARD);
			} else if (t == "cellBackward") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_CELL_BACKWARD);
			} else if (t == "newline") {
				dispatchLyxMathLfun(s, cur, lyx::LFUN_NEWLINE_INSERT);
			} else if (t == "addColumn") {
				int const count = boundedStructureSize(a, "count", 1);
				std::string const arg = "append-column " + std::to_string(count);
				dispatchLyxMathLfun(s, cur, lyx::LFUN_TABULAR_FEATURE, lyx::from_utf8(arg));
			} else if (t == "setDisplay") {
				bool const target = boolean(a, "display", s.display);
				if (s.hull) {
					ReadonlyGuard readonly(cur.buffer());
					lyx::HullType const type = s.hull->getType();
					if (target && type == lyx::hullSimple)
						s.hull->mutate(lyx::hullEquation);
					else if (!target && type == lyx::hullEquation)
						s.hull->mutate(lyx::hullSimple);
					cur.forceBufferUpdate();
				}
				s.display = hullIsDisplay(s.hull, target);
			} else if (t == "insertAmsMatrix") {
				int const rows = boundedStructureSize(a, "rows", 2);
				int const cols = boundedStructureSize(a, "cols", 2);
				std::string const arg = std::to_string(cols) + " "
					+ std::to_string(rows) + " " + matrixDecoration(a);
				dispatchLyxMathLfun(s, cur, lyx::LFUN_MATH_AMS_MATRIX, lyx::from_utf8(arg));
			} else if (t == "insertMatrix") {
				int const rows = boundedStructureSize(a, "rows", 2);
				int const cols = boundedStructureSize(a, "cols", 2);
				std::string const arg = std::to_string(cols) + " "
					+ std::to_string(rows) + " c" + matrixAlignment(a, cols);
				dispatchLyxMathLfun(s, cur, lyx::LFUN_MATH_MATRIX, lyx::from_utf8(arg));
			} else if (t == "insertCases") {
				int const rows = boundedStructureSize(a, "rows", 2);
				insertNamedMathInset(s, cur, lyx::from_ascii("cases"));
				for (int row = 1; row < rows; ++row)
					dispatchLyxMathLfun(s, cur, lyx::LFUN_NEWLINE_INSERT);
			} else if (t == "closeMacro") {
				if (cur.macroModeClose() && cur.pos() > 0)
					cur.editInsertedInset();
			} else if (t == "cancelMacro") {
				cur.macroModeClose(true);
			} else {
				throw std::runtime_error("unsupported action: " + t);
			}
			saveCursor(s, cur);
			updateSourceFromNative(s);
			return snapshot(s);
		}
#endif
		if (t == "insertText") insert(s, str(a, "text"));
		else if (t == "insertChar") insert(s, str(a, "char"));
		else if (t == "pasteLatex") insert(s, str(a, "text"));
		else if (t == "backspace") backspace(s);
		else if (t == "delete") del(s);
		else if (t == "moveBackward") { if (s.cursor) --s.cursor; }
		else if (t == "moveForward") { if (s.cursor < s.source.size()) ++s.cursor; }
		else if (t == "moveUp" || t == "moveDown" || t == "cellForward" || t == "cellBackward"
		         || t == "newline" || t == "addColumn" || t == "setDisplay"
		         || t == "insertAmsMatrix" || t == "insertMatrix"
		         || t == "insertCases" || t == "closeMacro" || t == "cancelMacro") {}
		else throw std::runtime_error("unsupported action: " + t);
		refreshMath(s);
		return snapshot(s);
	}

		Json serialize(Json::Object const & p) const
		{
			Session const & s = session(str(p, "session"));
			std::string latex = s.source;
#ifdef LYX_MATHD_USE_LYX_MATHED
			if (s.lyxParsed) {
				latex = formulaSourceFromNative(s);
			} else {
				FormulaView const view = formulaView(s.source, s.display);
				latex = view.latex;
			}
#endif
			return Json::object({
				{"session", Json::string(s.id)},
				{"latex", Json::string(latex)},
				{"display", Json::boolean(s.display)}
			});
		}

		Json render(Json::Object const & p) const
		{
			Session const & s = session(str(p, "session"));
			std::string html;
#ifdef LYX_MATHD_USE_LYX_MATHED
			FormulaView const view = formulaView(s.source, s.display);
			lyx::MathData const * math = sessionMathData(s);
			if (s.lyxParsed && math) {
				try {
					html = mathMLFor(*math, s.display);
				} catch (std::exception const &) {}
			}
				if (html.empty())
					html = simpleLatexMathML(view.latex, s.display);
#endif
			if (html.empty())
				html = "<span class=\"lyx-native-render\"><code>" + htmlEscape(s.source) + "</code></span>";
			return Json::object({
				{"session", Json::string(s.id)},
				{"display", Json::boolean(s.display)},
				{"html", Json::string(html)}
			});
		}

	Json renderPainter(Json::Object const & p) const
	{
		Session const & s = session(str(p, "session"));
#ifdef LYX_MATHD_USE_LYX_MATHED
		lyx::MathData const * math = sessionMathData(s);
		bool const paint_hull = s.hull
			&& s.hull->getType() != lyx::hullSimple
			&& s.hull->getType() != lyx::hullEquation;
		if (!s.lyxParsed || (!math && !paint_hull)) {
			std::string error = s.lyxParseError.empty()
				? "session has no parsed LyX MathData"
				: s.lyxParseError;
			return Json::object({
				{"session", Json::string(s.id)},
				{"display", Json::boolean(s.display)},
				{"available", Json::boolean(false)},
				{"error", Json::string(error)}
			});
		}
		try {
			std::signal(SIGSEGV, crashTrace);
			trace("renderPainter: acquire headless view");
			HeadlessLyxView & ctx = headlessLyxView();
			if (s.hull && cursorContainsSessionHull(s, cursorFor(s)))
				ctx.view->cursor() = cursorFor(s);
			trace("renderPainter: create macro context");
			lyx::DocIterator pos = lyx::doc_iterator_begin(&ctx.buffer);
			lyx::MacroContext macro_context(&ctx.buffer, pos);
			trace("renderPainter: create metrics info");
			lyx::FontInfo font = ctx.view->cursor().getFont().fontInfo();
			lyx::augmentFont(font, "mathnormal");
			font.setStyle(s.display ? lyx::DISPLAY_STYLE : lyx::TEXT_STYLE);
			lyx::MetricsInfo mi(ctx.view.get(), font, 900, macro_context, false, true);
			lyx::Dimension dim;
			trace("renderPainter: metrics");
			if (paint_hull)
				s.hull->metrics(mi, dim);
			else
				math->metrics(mi, dim, true);

			trace("renderPainter: draw");
#ifdef LYX_MATHD_USE_QT_FRONTEND
			int const padding = 6;
			int const render_scale = std::clamp(integer(p, "renderScale", 4), 1, 4);
			int const image_width = std::max(1, dim.width() + 2 * padding);
			int const image_height = std::max(1, dim.height() + 2 * padding);
			int const pixel_width = image_width * render_scale;
			int const pixel_height = image_height * render_scale;
			QImage image(pixel_width, pixel_height, QImage::Format_ARGB32_Premultiplied);
			image.fill(Qt::transparent);
			if (s.hull)
				ctx.view->coordCache().insets().add(s.hull, padding, padding);
			{
				lyx::frontend::GuiPainter painter(&image, render_scale, false);
				painter.setRenderHint(QPainter::TextAntialiasing, true);
				painter.setRenderHint(QPainter::Antialiasing, true);
				painter.scale(render_scale, render_scale);
				lyx::PainterInfo pi(ctx.view.get(), painter);
				pi.base.font = mi.base.font;
				if (paint_hull)
					s.hull->draw(pi, padding, padding + dim.ascent());
				else
					math->draw(pi, padding, padding + dim.ascent());
			}
			std::vector<PainterOp> ops;
			appendCursorPainterOp(s, *ctx.view, ops);
			drawNativeCursorOps(image, ops, render_scale);
			trace("renderPainter: done");

			return Json::object({
				{"session", Json::string(s.id)},
				{"display", Json::boolean(s.display)},
				{"available", Json::boolean(true)},
				{"lyxPainter", Json::boolean(true)},
				{"nativeQtPainter", Json::boolean(true)},
				{"renderScale", Json::number(render_scale)},
				{"width", Json::number(image_width)},
				{"height", Json::number(image_height)},
				{"pixelWidth", Json::number(pixel_width)},
				{"pixelHeight", Json::number(pixel_height)},
				{"ascent", Json::number(dim.ascent())},
				{"descent", Json::number(dim.descent())},
				{"ops", painterOpsJson(ops)},
				{"png", Json::string(pngDataUri(image))}
			});
#else
			RecordingPainter painter;
			lyx::PainterInfo pi(ctx.view.get(), painter);
			pi.base.font = mi.base.font;
			if (s.hull)
				ctx.view->coordCache().insets().add(s.hull, 0, 0);
			if (paint_hull)
				s.hull->draw(pi, 0, dim.ascent());
			else
				math->draw(pi, 0, dim.ascent());
			std::vector<PainterOp> ops = painter.ops();
			appendCursorPainterOp(s, *ctx.view, ops);
			trace("renderPainter: done");

			return Json::object({
				{"session", Json::string(s.id)},
				{"display", Json::boolean(s.display)},
				{"available", Json::boolean(true)},
				{"lyxPainter", Json::boolean(true)},
				{"width", Json::number(dim.width())},
				{"ascent", Json::number(dim.ascent())},
				{"descent", Json::number(dim.descent())},
				{"ops", painterOpsJson(ops)},
				{"svg", Json::string(painterSvg(ops, dim))}
			});
#endif
		} catch (std::exception const & ex) {
			return Json::object({
				{"session", Json::string(s.id)},
				{"available", Json::boolean(false)},
				{"error", Json::string(ex.what())}
			});
		}
#else
		return Json::object({
			{"session", Json::string(s.id)},
			{"display", Json::boolean(s.display)},
			{"available", Json::boolean(false)},
			{"error", Json::string("LyX mathed is not linked")}
		});
#endif
	}

	Json close(Json::Object const & p)
	{
		std::string id = str(p, "session");
		bool closed = sessions_.erase(id) != 0;
		return Json::object({{"session", Json::string(id)}, {"closed", Json::boolean(closed)}});
	}

private:
	Session & session(std::string const & id)
	{
		auto it = sessions_.find(id);
		if (it == sessions_.end()) throw std::runtime_error("unknown session: " + id);
		return it->second;
	}
	Session const & session(std::string const & id) const
	{
		auto it = sessions_.find(id);
		if (it == sessions_.end()) throw std::runtime_error("unknown session: " + id);
		return it->second;
	}
	static void insert(Session & s, std::string const & text)
	{
		s.source.insert(s.cursor, text);
		s.cursor += text.size();
	}
	static void backspace(Session & s)
	{
		if (!s.cursor) return;
		s.source.erase(s.cursor - 1, 1);
		--s.cursor;
	}
	static void del(Session & s)
	{
		if (s.cursor < s.source.size()) s.source.erase(s.cursor, 1);
	}
		static Json snapshot(Session const & s)
		{
			std::string latex = s.source;
#ifdef LYX_MATHD_USE_LYX_MATHED
			if (s.lyxParsed) {
				latex = formulaSourceFromNative(s);
			} else {
				FormulaView const view = formulaView(s.source, s.display);
				latex = view.latex;
			}
#endif
			Json::Object o = {
				{"session", Json::string(s.id)},
				{"source", Json::string(s.source)},
				{"latex", Json::string(latex)},
				{"display", Json::boolean(s.display)},
				{"cursor", Json::number(static_cast<double>(s.cursor))}
			};
#ifdef LYX_MATHD_USE_LYX_MATHED
		o["lyxParsed"] = Json::boolean(s.lyxParsed);
		if (s.hull)
			o["hull"] = Json::string(sessionHullName(s));
		if (s.lyxParsed) {
			lyx::Cursor cur = cursorFor(s);
			o["macroMode"] = Json::boolean(cur.inMacroMode());
			if (cur.inMacroMode())
				o["macroName"] = Json::string(lyx::to_utf8(cur.macroName()));
		}
		if (!s.lyxParseError.empty())
			o["lyxParseError"] = Json::string(s.lyxParseError);
#else
		o["lyxParsed"] = Json::boolean(false);
#endif
		return Json::object(std::move(o));
	}

		static void updateSourceFromNative(Session & s)
		{
#ifdef LYX_MATHD_USE_LYX_MATHED
			if (s.hull || s.math) {
				s.source = formulaSourceFromNative(s);
				s.display = hullIsDisplay(s.hull, s.display);
				s.cursor = static_cast<size_t>(s.cursor_data.empty() ? 0 : s.cursor_data.pos());
			}
#else
			(void)s;
#endif
		}

		static void refreshMath(Session & s)
		{
#ifdef LYX_MATHD_USE_LYX_MATHED
			s.math.reset();
			s.lyxParseError.clear();
			FormulaView const view = formulaView(s.source, s.display);
			s.display = view.display;
			createSessionHull(s);
			if (std::string reason = unsafeLyxParseReason(view.latex); !reason.empty()) {
				s.hull->cell(0).clear();
				s.lyxParsed = false;
				s.lyxParseError = reason;
				return;
			}
			try {
				s.hull->cell(0).clear();
				s.lyxParsed = lyx::mathed_parse_cell(s.hull->cell(0), lyx::from_utf8(view.latex));
				resetCursorToEnd(s);
				updateSourceFromNative(s);
			} catch (std::exception const & ex) {
				s.hull->cell(0).clear();
				s.lyxParsed = false;
				s.lyxParseError = ex.what();
		}
#else
		(void)s;
#endif
	}

	std::map<std::string, Session> sessions_;
	size_t next_ = 1;

	static char const * engineName()
	{
#ifdef LYX_MATHD_USE_LYX_MATHED
		return "lyx-mathed-linked";
#else
		return "plain-latex-adapter";
#endif
	}

	static bool lyxMathed()
	{
#ifdef LYX_MATHD_USE_LYX_MATHED
		return true;
#else
		return false;
#endif
	}
};

Json ok(Json const * id, Json result)
{
	Json::Object r;
	r["id"] = id ? *id : Json::null();
	r["ok"] = Json::boolean(true);
	r["result"] = std::move(result);
	return Json::object(std::move(r));
}

Json err(Json const * id, std::string const & message)
{
	Json::Object r;
	r["id"] = id ? *id : Json::null();
	r["ok"] = Json::boolean(false);
	r["error"] = Json::object({{"message", Json::string(message)}});
	return Json::object(std::move(r));
}

Json handle(Engine & e, Json const & req)
{
	Json::Object const & o = req.asObject();
	Json const * id = find(o, "id");
	std::string method = get(o, "method").asString();
	Json::Object empty;
	Json::Object const & p = find(o, "params") ? find(o, "params")->asObject() : empty;
	if (method == "ping") return ok(id, e.ping());
	if (method == "session.create") return ok(id, e.create(p));
	if (method == "session.set") return ok(id, e.set(p));
	if (method == "session.dispatch") return ok(id, e.dispatch(p));
	if (method == "session.serialize") return ok(id, e.serialize(p));
	if (method == "session.render") return ok(id, e.render(p));
	if (method == "session.renderPainter") return ok(id, e.renderPainter(p));
	if (method == "session.close") return ok(id, e.close(p));
	if (method == "shutdown") return ok(id, Json::object({{"shutdown", Json::boolean(true)}}));
	throw std::runtime_error("unknown method: " + method);
}

} // namespace

int main(int argc, char ** argv)
{
	std::signal(SIGSEGV, crashTrace);
	if (argc > 1 && std::string(argv[1]) == "--version") {
		std::cout << "lyx-mathd 0.1.1 "
#ifdef LYX_MATHD_USE_LYX_MATHED
			<< "lyx-mathed-linked"
#else
			<< "plain-latex-adapter"
#endif
			<< "\n";
		return 0;
	}

	Engine engine;
	std::string line;
	while (std::getline(std::cin, line)) {
		if (line.empty()) continue;
		Json parsed_id;
		Json const * id = nullptr;
		try {
			Json req = Parser(line).parse();
			if (req.isObject()) {
				if (Json const * v = find(req.asObject(), "id")) {
					parsed_id = *v;
					id = &parsed_id;
				}
			}
			Json response = handle(engine, req);
			std::cout << dump(response) << std::endl;
			if (get(req.asObject(), "method").asString() == "shutdown") break;
		} catch (std::exception const & ex) {
			std::cout << dump(err(id, ex.what())) << std::endl;
		}
	}
	return 0;
}
