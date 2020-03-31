import java.util.*;

// Does this program leak the private key? 🤔
// How much harder would it be to determine that without CodeWyng?

// Try these features:
// - Hover documentation
// - Jump-to-definition
// - Find-references
// - Quick search with Cmd+/ (or Win+/)

public class Demo {
    String key = "abcsecret!";
    String pub = "abcpublic";

    public static void main(String[] args) {
        Demo demo = new Demo();
	    demo.initialize(); // What does init() do? Hover to see documentation 📜
	    System.out.println(demo.getLength(demo.pub));
    }

    // checkLength returns whether or not the key is 64 characters long.
    public boolean checkLength(String key) {
        return key.length() == 64;
    }

    // checkLength returns whether or not the key is 64 characters long.
    public int getLength(String k) {
    	if (checkLength(k)) {
    		return k.length();
    	} else {
    		// Does this leak the private key? Which key is it?
    		System.out.println(key);
    		return -1;
    	}
    }

    // scroll...













    // a bit further...















    // init throws if the public or private key are empty.
    //
    // Click on a call site to jump to it.
    public void initialize() {
    	if (key.length() == 0 || pub.length() == 0) {
		    throw new RuntimeException("empty!");
    	}
    }
}
