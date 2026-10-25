# prints the Ultra web address after a deploy (empty if it can't be read)
import modal
try:
    print(modal.Cls.from_name("feole-ultra", "Ultra")().web.get_web_url())
except Exception:
    print("")
