#include <config.h>

#include "HunspellChecker.h"
#include "Color.h"
#include "Dimension.h"
#include "Font.h"
#include "FontInfo.h"
#include "FuncRequest.h"
#include "frontends/Application.h"
#include "frontends/alert.h"
#include "frontends/Clipboard.h"
#include "frontends/FontLoader.h"
#include "frontends/FontMetrics.h"
#include "frontends/KeySymbol.h"
#include "frontends/Painter.h"
#include "frontends/Selection.h"
#include "graphics/GraphicsImage.h"
#include "graphics/GraphicsParams.h"
#include "support/FileName.h"

namespace lyx {

namespace {

#ifndef LYX_MATHD_USE_QT_FRONTEND
class HeadlessFontMetrics : public frontend::FontMetrics {
public:
	int maxAscent() const override { return 13; }
	int maxDescent() const override { return 4; }
	Dimension const defaultDimension() const override { return Dimension(8, maxAscent(), maxDescent()); }
	int em() const override { return 16; }
	int xHeight() const override { return 8; }
	int lineWidth() const override { return 1; }
	int underlinePos() const override { return 2; }
	int strikeoutPos() const override { return 5; }
	bool italic() const override { return false; }
	double italicSlope() const override { return 0.0; }
	int ascent(char_type) const override { return maxAscent(); }
	int descent(char_type) const override { return maxDescent(); }
	int lbearing(char_type) const override { return 0; }
	int rbearing(char_type c) const override { return width(c); }
	int width(char_type c) const override
	{
		if (c == ' ')
			return 4;
		if (c >= '0' && c <= '9')
			return 8;
		if (c < 128)
			return 9;
		return 12;
	}
	int width(docstring const & s) const override
	{
		int result = 0;
		for (char_type c : s)
			result += width(c);
		return result;
	}
	int signedWidth(docstring const & s) const override { return width(s); }
	int pos2x(docstring const & s, int pos, bool rtl, double) const override
	{
		if (pos < 0)
			pos = 0;
		if (pos > static_cast<int>(s.size()))
			pos = static_cast<int>(s.size());
		int x = 0;
		if (!rtl) {
			for (int i = 0; i < pos; ++i)
				x += width(s[i]);
		} else {
			for (int i = pos; i < static_cast<int>(s.size()); ++i)
				x += width(s[i]);
		}
		return x;
	}
	int x2pos(docstring const & s, int & x, bool rtl, double) const override
	{
		int pos = 0;
		int running = 0;
		for (; pos < static_cast<int>(s.size()); ++pos) {
			int const next = running + width(s[pos]);
			if (x < next)
				break;
			running = next;
		}
		x = rtl ? width(s) - running : running;
		return pos;
	}
	Breaks breakString(docstring const & s, int first_wid, int wid,
	                    bool, bool force) const override
	{
		Breaks breaks;
		int limit = first_wid > 0 ? first_wid : wid;
		if (limit <= 0 || width(s) <= limit) {
			breaks.emplace_back(static_cast<int>(s.size()), dimension(s), width(s));
			return breaks;
		}

		int start = 0;
		while (start < static_cast<int>(s.size())) {
			int used = 0;
			int len = 0;
			while (start + len < static_cast<int>(s.size())) {
				int const next = used + width(s[start + len]);
				if (len > 0 && next > limit)
					break;
				used = next;
				++len;
				if (!force && s[start + len - 1] == ' ')
					break;
			}
			breaks.emplace_back(len, Dimension(used, maxAscent(), maxDescent()), used);
			start += len;
			limit = wid;
		}
		return breaks;
	}
	Dimension const dimension(docstring const & str) const override
	{
		return Dimension(width(str), maxAscent(), maxDescent());
	}
	Dimension const dimension(char_type c) const override
	{
		return Dimension(width(c), maxAscent(), maxDescent());
	}
	void rectText(docstring const & str, int & w, int & a, int & d) const override
	{
		w = width(str);
		a = maxAscent();
		d = maxDescent();
	}
	void buttonText(docstring const & str, const int offset,
	                int & w, int & a, int & d) const override
	{
		w = width(str) + 2 * offset;
		a = maxAscent() + offset;
		d = maxDescent() + offset;
	}
};

class HeadlessClipboard : public frontend::Clipboard {
public:
	std::string const getAsLyX() const override { return {}; }
	docstring const getAsText(TextType) const override { return docstring(); }
	support::FileName getAsGraphics(Cursor const &, GraphicsType) const override
	{
		return support::FileName();
	}
	void put(std::string const &, docstring const &, docstring const &) override {}
	void put(std::string const &) const override {}
	bool hasTextContents(TextType = AnyTextType) const override { return false; }
	bool hasGraphicsContents(GraphicsType = AnyGraphicsType) const override { return false; }
	bool isInternal() const override { return false; }
	bool hasInternal() const override { return false; }
	bool empty() const override { return true; }
};

class HeadlessSelection : public frontend::Selection {
public:
	bool supported() const override { return false; }
	void haveSelection(bool) override {}
	docstring const get() const override { return docstring(); }
	void put(docstring const &) override {}
	bool empty() const override { return true; }
};

class HeadlessImage : public graphics::Image {
public:
	Image * clone() const override { return new HeadlessImage(*this); }
	unsigned int width() const override { return 0; }
	unsigned int height() const override { return 0; }
	bool isDrawable() const override { return false; }
	bool load(support::FileName const &) override { return false; }
	bool setPixmap(graphics::Params const &) override { return false; }
};
#endif

} // namespace

#ifndef LYX_MATHD_USE_QT_FRONTEND
namespace frontend {

const int Painter::thin_line = 1;

FontLoader::FontLoader() = default;
FontLoader::~FontLoader() = default;
void FontLoader::update() {}
bool FontLoader::available(FontInfo const &) { return false; }
bool FontLoader::canBeDisplayed(char_type) { return true; }
FontMetrics const & FontLoader::metrics(FontInfo const & f) { return theFontMetrics(f); }

bool Application::getRgbColorUncached(ColorCode, RGBColor & rgbcol)
{
	rgbcol = RGBColor(0, 0, 0);
	return true;
}

docstring Application::iconName(FuncRequest const &, bool)
{
	return docstring();
}

docstring Application::mathIcon(docstring const & c)
{
	return c;
}

void Application::applyPrefs() {}

namespace Alert {

buttonid prompt(docstring const &, docstring const &, buttonid default_button,
                buttonid, docstring const &, docstring const &,
                docstring const &, docstring const &)
{
	return default_button;
}

void warning(docstring const &, docstring const &, bool) {}
void error(docstring const &, docstring const &, bool) {}
void information(docstring const &, docstring const &) {}

bool askForText(docstring & response, docstring const &, docstring const & dflt)
{
	response = dflt;
	return true;
}

} // namespace Alert

std::vector<std::string> loadableImageFormats()
{
	return {};
}

} // namespace frontend

frontend::Application * createApplication(int &, char **)
{
	return nullptr;
}

void hideDialogs(std::string const &, Inset *)
{
}

void setLocale()
{
}

frontend::FontMetrics const & theFontMetrics(FontInfo const &)
{
	static HeadlessFontMetrics metrics;
	return metrics;
}

frontend::FontMetrics const & theFontMetrics(Font const & f)
{
	return theFontMetrics(f.fontInfo());
}

frontend::FontLoader & theFontLoader()
{
	static frontend::FontLoader loader;
	return loader;
}

frontend::Clipboard & theClipboard()
{
	static HeadlessClipboard clipboard;
	return clipboard;
}

frontend::Selection & theSelection()
{
	static HeadlessSelection selection;
	return selection;
}

bool KeySymbol::operator==(KeySymbol const & ks) const
{
	return key_ == ks.key_ && text_ == ks.text_;
}

void KeySymbol::init(std::string const & symbolname)
{
	text_.clear();
	key_ = 0;
	if (symbolname.empty())
		return;
	if (symbolname.size() == 1) {
		key_ = static_cast<unsigned char>(symbolname[0]);
		text_.push_back(static_cast<char_type>(key_));
	}
}

void KeySymbol::init(int key)
{
	key_ = key;
	text_.clear();
	if (key > 0 && key < 128)
		text_.push_back(static_cast<char_type>(key));
}

bool KeySymbol::isOK() const
{
	return key_ != 0 || !text_.empty();
}

bool KeySymbol::isModifier() const
{
	return false;
}

bool KeySymbol::isText() const
{
	return !text_.empty();
}

std::string KeySymbol::getSymbolName() const
{
	if (!text_.empty() && text_[0] < 128)
		return std::string(1, static_cast<char>(text_[0]));
	if (key_ > 0 && key_ < 128)
		return std::string(1, static_cast<char>(key_));
	return {};
}

char_type KeySymbol::getUCSEncoded() const
{
	if (!text_.empty())
		return text_[0];
	return static_cast<char_type>(key_);
}

docstring const KeySymbol::print(KeyModifier, bool, bool) const
{
	if (!text_.empty())
		return text_;
	std::string const name = getSymbolName();
	docstring out;
	for (char c : name)
		out.push_back(static_cast<char_type>(static_cast<unsigned char>(c)));
	return out;
}

namespace graphics {

Image * newImage()
{
	return new HeadlessImage();
}

} // namespace graphics
#endif

#ifdef LYX_MATHD_USE_QT_FRONTEND
namespace frontend {
namespace Alert {

buttonid prompt(docstring const &, docstring const &, buttonid default_button,
                buttonid, docstring const &, docstring const &,
                docstring const &, docstring const &)
{
	return default_button;
}

void warning(docstring const &, docstring const &, bool) {}
void error(docstring const &, docstring const &, bool) {}
void information(docstring const &, docstring const &) {}

bool askForText(docstring & response, docstring const &, docstring const & dflt)
{
	response = dflt;
	return true;
}

} // namespace Alert
} // namespace frontend
#endif

HunspellChecker::HunspellChecker() : d(nullptr)
{
}

HunspellChecker::~HunspellChecker()
{
}

SpellChecker::Result HunspellChecker::check(WordLangTuple const &,
	std::vector<WordLangTuple> const &)
{
	return NO_DICTIONARY;
}

void HunspellChecker::suggest(WordLangTuple const &, docstring_list &)
{
}

void HunspellChecker::stem(WordLangTuple const &, docstring_list &)
{
}

void HunspellChecker::insert(WordLangTuple const &)
{
}

void HunspellChecker::remove(WordLangTuple const &)
{
}

void HunspellChecker::accept(WordLangTuple const &)
{
}

bool HunspellChecker::hasDictionary(Language const *) const
{
	return false;
}

int HunspellChecker::numDictionaries() const
{
	return 0;
}

docstring const HunspellChecker::error()
{
	return docstring();
}

void HunspellChecker::advanceChangeNumber()
{
	nextChangeNumber();
}

} // namespace lyx
